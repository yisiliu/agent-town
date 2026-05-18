import type {
  DataModelFromSchemaDefinition,
  GenericMutationCtx,
  GenericQueryCtx,
} from 'convex/server';
import {
  generateRegistrationOptions as libGenRegOpts,
  generateAuthenticationOptions as libGenAuthOpts,
  verifyRegistrationResponse as libVerifyReg,
  verifyAuthenticationResponse as libVerifyAuth,
  type GenerateRegistrationOptionsOpts,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import type schema from '../../schema';

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
type MutationCtx = GenericMutationCtx<DataModel>;
type QueryCtx = GenericQueryCtx<DataModel>;
type InstructorId = DataModel['instructors']['document']['_id'];

// Relying-party config. RP_ID must match the eTLD+1 the browser sees;
// in production this is the shell's hostname. ORIGIN must include the
// scheme. Both come from environment so dev/staging/prod can coexist.
const RP_NAME = 'agent-town';
function rpID(): string {
  return (
    (typeof process !== 'undefined' && process.env.AGENT_TOWN_RP_ID) ||
    'localhost'
  );
}
function origin(): string {
  return (
    (typeof process !== 'undefined' && process.env.AGENT_TOWN_ORIGIN) ||
    'http://localhost:3000'
  );
}

export const INSTRUCTOR_SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
const CHALLENGE_TTL_MS = 5 * 60 * 1_000;

async function findOrCreateInstructor(
  ctx: MutationCtx,
  username: string,
  displayName: string,
  now: number,
): Promise<InstructorId> {
  const existing = await ctx.db
    .query('instructors')
    .withIndex('username', (q) => q.eq('username', username))
    .unique();
  if (existing) return existing._id;
  return ctx.db.insert('instructors', { username, displayName, createdAt: now });
}

async function storeChallenge(
  ctx: MutationCtx,
  username: string,
  ceremony: 'register' | 'authenticate',
  challenge: string,
  now: number,
) {
  const prior = await ctx.db
    .query('instructorChallenges')
    .withIndex('username_ceremony', (q) =>
      q.eq('username', username).eq('ceremony', ceremony),
    )
    .unique();
  const payload = {
    username,
    ceremony,
    challenge,
    issuedAt: now,
    expiresAt: now + CHALLENGE_TTL_MS,
  };
  if (prior) await ctx.db.replace(prior._id, payload);
  else await ctx.db.insert('instructorChallenges', payload);
}

async function consumeChallenge(
  ctx: MutationCtx,
  username: string,
  ceremony: 'register' | 'authenticate',
  now: number,
): Promise<string | null> {
  const row = await ctx.db
    .query('instructorChallenges')
    .withIndex('username_ceremony', (q) =>
      q.eq('username', username).eq('ceremony', ceremony),
    )
    .unique();
  if (!row) return null;
  await ctx.db.delete(row._id);
  if (now >= row.expiresAt) return null;
  return row.challenge;
}

export async function beginInstructorRegistration(
  ctx: MutationCtx,
  args: { username: string; displayName: string },
  now: number,
): Promise<ReturnType<typeof libGenRegOpts> extends Promise<infer T> ? T : never> {
  const instructorId = await findOrCreateInstructor(
    ctx,
    args.username,
    args.displayName,
    now,
  );

  const existing = await ctx.db
    .query('instructorAuthenticators')
    .withIndex('instructorId', (q) => q.eq('instructorId', instructorId))
    .collect();

  const opts: GenerateRegistrationOptionsOpts = {
    rpName: RP_NAME,
    rpID: rpID(),
    userID: new TextEncoder().encode(instructorId),
    userName: args.username,
    userDisplayName: args.displayName,
    attestationType: 'none',
    excludeCredentials: existing.map((a) => ({
      id: a.credentialId,
      transports: a.transports as AuthenticatorTransportFuture[] | undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  };
  const options = await libGenRegOpts(opts);
  await storeChallenge(ctx, args.username, 'register', options.challenge, now);
  return options;
}

export async function completeInstructorRegistration(
  ctx: MutationCtx,
  args: { username: string; response: RegistrationResponseJSON },
  now: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const challenge = await consumeChallenge(ctx, args.username, 'register', now);
  if (!challenge) return { ok: false, reason: 'no active challenge' };

  let verification;
  try {
    verification = await libVerifyReg({
      response: args.response,
      expectedChallenge: challenge,
      expectedOrigin: origin(),
      expectedRPID: rpID(),
    });
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, reason: 'verification failed' };
  }

  const instructor = await ctx.db
    .query('instructors')
    .withIndex('username', (q) => q.eq('username', args.username))
    .unique();
  if (!instructor) return { ok: false, reason: 'instructor not found' };

  const info = verification.registrationInfo;
  await ctx.db.insert('instructorAuthenticators', {
    instructorId: instructor._id,
    credentialId: info.credential.id,
    credentialPublicKey: info.credential.publicKey.buffer.slice(
      info.credential.publicKey.byteOffset,
      info.credential.publicKey.byteOffset + info.credential.publicKey.byteLength,
    ) as ArrayBuffer,
    counter: info.credential.counter,
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    transports: info.credential.transports as string[] | undefined,
    registeredAt: now,
  });

  return { ok: true };
}

export async function beginInstructorAuthentication(
  ctx: MutationCtx,
  args: { username: string },
  now: number,
): Promise<ReturnType<typeof libGenAuthOpts> extends Promise<infer T> ? T : never> {
  const instructor = await ctx.db
    .query('instructors')
    .withIndex('username', (q) => q.eq('username', args.username))
    .unique();
  if (!instructor) {
    throw new Error('unknown instructor');
  }
  const authenticators = await ctx.db
    .query('instructorAuthenticators')
    .withIndex('instructorId', (q) => q.eq('instructorId', instructor._id))
    .collect();
  if (authenticators.length === 0) {
    throw new Error('no registered authenticator');
  }

  const options = await libGenAuthOpts({
    rpID: rpID(),
    allowCredentials: authenticators.map((a) => ({
      id: a.credentialId,
      transports: a.transports as AuthenticatorTransportFuture[] | undefined,
    })),
    userVerification: 'preferred',
  });
  await storeChallenge(ctx, args.username, 'authenticate', options.challenge, now);
  return options;
}

function generateSessionToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function completeInstructorAuthentication(
  ctx: MutationCtx,
  args: { username: string; response: AuthenticationResponseJSON },
  now: number,
): Promise<
  | { ok: true; token: string; expiresAt: number }
  | { ok: false; reason: string }
> {
  const challenge = await consumeChallenge(
    ctx,
    args.username,
    'authenticate',
    now,
  );
  if (!challenge) return { ok: false, reason: 'no active challenge' };

  const credentialId = args.response.id;
  const authenticator = await ctx.db
    .query('instructorAuthenticators')
    .withIndex('credentialId', (q) => q.eq('credentialId', credentialId))
    .unique();
  if (!authenticator) {
    return { ok: false, reason: 'unknown credential' };
  }

  let verification;
  try {
    verification = await libVerifyAuth({
      response: args.response,
      expectedChallenge: challenge,
      expectedOrigin: origin(),
      expectedRPID: rpID(),
      credential: {
        id: authenticator.credentialId,
        publicKey: new Uint8Array(authenticator.credentialPublicKey),
        counter: authenticator.counter,
        transports: authenticator.transports as
          | AuthenticatorTransportFuture[]
          | undefined,
      },
    });
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }

  if (!verification.verified) {
    return { ok: false, reason: 'signature invalid' };
  }

  // Counter rotation — a stale counter would be evidence of a cloned
  // authenticator and `libVerifyAuth` already rejects above; here we
  // persist the fresh value so the next assertion compares against it.
  await ctx.db.patch(authenticator._id, {
    counter: verification.authenticationInfo.newCounter,
  });

  const token = generateSessionToken();
  const expiresAt = now + INSTRUCTOR_SESSION_TTL_MS;
  await ctx.db.insert('instructorSessions', {
    token,
    instructorId: authenticator.instructorId,
    role: 'instructor',
    issuedAt: now,
    expiresAt,
  });
  return { ok: true, token, expiresAt };
}

export interface InstructorSessionRecord {
  instructorId: InstructorId;
  role: 'instructor';
  expiresAt: number;
}

export async function getInstructorSession(
  ctx: QueryCtx,
  token: string,
  now: number,
): Promise<InstructorSessionRecord | null> {
  const row = await ctx.db
    .query('instructorSessions')
    .withIndex('token', (q) => q.eq('token', token))
    .unique();
  if (!row) return null;
  if (now >= row.expiresAt) return null;
  return {
    instructorId: row.instructorId,
    role: row.role,
    expiresAt: row.expiresAt,
  };
}
