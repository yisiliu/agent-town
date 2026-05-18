import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @simplewebauthn/server BEFORE importing the lib. The library does
// real cryptographic verification — for unit tests we drive specific
// outcomes through the verify functions so we can exercise our state
// machine (challenge persistence, counter rotation, session issuance)
// without round-tripping a real WebAuthn ceremony.
const mockRegOptions = vi.hoisted(() => vi.fn());
const mockAuthOptions = vi.hoisted(() => vi.fn());
const mockVerifyReg = vi.hoisted(() => vi.fn());
const mockVerifyAuth = vi.hoisted(() => vi.fn());

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: mockRegOptions,
  generateAuthenticationOptions: mockAuthOptions,
  verifyRegistrationResponse: mockVerifyReg,
  verifyAuthenticationResponse: mockVerifyAuth,
}));

import { convexTest } from 'convex-test';
import schema from '../schema';
import {
  beginInstructorRegistration,
  completeInstructorRegistration,
  beginInstructorAuthentication,
  completeInstructorAuthentication,
  getInstructorSession,
  INSTRUCTOR_SESSION_TTL_MS,
} from '../ours/lib/instructorAuth';

const modules = import.meta.glob('../**/*.ts');

const USER = 'prof-stein';
const DISPLAY = 'Prof. Stein';
const CRED_ID = 'cred-base64url-id';
const PUB_KEY = new Uint8Array([1, 2, 3, 4, 5]);

beforeEach(() => {
  mockRegOptions.mockReset();
  mockAuthOptions.mockReset();
  mockVerifyReg.mockReset();
  mockVerifyAuth.mockReset();
});

describe('instructor registration ceremony', () => {
  it('beginInstructorRegistration creates the instructor row and persists a challenge', async () => {
    mockRegOptions.mockResolvedValue({
      challenge: 'challenge-A',
      rp: { name: 'agent-town', id: 'localhost' },
      user: {},
      pubKeyCredParams: [],
    });

    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_700_000_000_000;
      const options = await beginInstructorRegistration(
        ctx,
        { username: USER, displayName: DISPLAY },
        t0,
      );

      expect(options.challenge).toBe('challenge-A');

      const instructor = await ctx.db
        .query('instructors')
        .withIndex('username', (q) => q.eq('username', USER))
        .unique();
      expect(instructor).not.toBeNull();
      expect(instructor!.displayName).toBe(DISPLAY);

      const challenge = await ctx.db
        .query('instructorChallenges')
        .withIndex('username_ceremony', (q) =>
          q.eq('username', USER).eq('ceremony', 'register'),
        )
        .unique();
      expect(challenge!.challenge).toBe('challenge-A');
      expect(challenge!.expiresAt).toBeGreaterThan(t0);
    });
  });

  it('re-beginning replaces the stale challenge (single row per (user, ceremony))', async () => {
    mockRegOptions
      .mockResolvedValueOnce({ challenge: 'first', rp: {}, user: {}, pubKeyCredParams: [] })
      .mockResolvedValueOnce({ challenge: 'second', rp: {}, user: {}, pubKeyCredParams: [] });

    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_700_000_000_000;
      await beginInstructorRegistration(
        ctx,
        { username: USER, displayName: DISPLAY },
        t0,
      );
      await beginInstructorRegistration(
        ctx,
        { username: USER, displayName: DISPLAY },
        t0 + 1_000,
      );

      const rows = await ctx.db
        .query('instructorChallenges')
        .withIndex('username_ceremony', (q) =>
          q.eq('username', USER).eq('ceremony', 'register'),
        )
        .collect();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.challenge).toBe('second');
    });
  });

  it('completeInstructorRegistration with a verified response stores the authenticator', async () => {
    mockRegOptions.mockResolvedValue({
      challenge: 'challenge-A',
      rp: {},
      user: {},
      pubKeyCredParams: [],
    });
    mockVerifyReg.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: CRED_ID,
          publicKey: PUB_KEY,
          counter: 0,
          transports: ['internal'],
        },
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
      },
    });

    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_700_000_000_000;
      await beginInstructorRegistration(
        ctx,
        { username: USER, displayName: DISPLAY },
        t0,
      );
      const result = await completeInstructorRegistration(
        ctx,
        { username: USER, response: {} as never },
        t0 + 1_000,
      );

      expect(result).toEqual({ ok: true });

      const authenticators = await ctx.db
        .query('instructorAuthenticators')
        .withIndex('credentialId', (q) => q.eq('credentialId', CRED_ID))
        .collect();
      expect(authenticators).toHaveLength(1);
      expect(authenticators[0]!.counter).toBe(0);
      expect(authenticators[0]!.deviceType).toBe('multiDevice');
      expect(authenticators[0]!.backedUp).toBe(true);

      // Challenge is consumed once the ceremony completes — replaying
      // the same response must fail with "no active challenge".
      const challenge = await ctx.db
        .query('instructorChallenges')
        .withIndex('username_ceremony', (q) =>
          q.eq('username', USER).eq('ceremony', 'register'),
        )
        .unique();
      expect(challenge).toBeNull();
    });
  });

  it('completeInstructorRegistration with verified=false does not persist the authenticator', async () => {
    mockRegOptions.mockResolvedValue({ challenge: 'c', rp: {}, user: {}, pubKeyCredParams: [] });
    mockVerifyReg.mockResolvedValue({ verified: false });

    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_700_000_000_000;
      await beginInstructorRegistration(
        ctx,
        { username: USER, displayName: DISPLAY },
        t0,
      );
      const result = await completeInstructorRegistration(
        ctx,
        { username: USER, response: {} as never },
        t0 + 1_000,
      );
      expect(result.ok).toBe(false);

      const auths = await ctx.db.query('instructorAuthenticators').collect();
      expect(auths).toHaveLength(0);
    });
  });

  it('completeInstructorRegistration with an expired challenge refuses to verify', async () => {
    mockRegOptions.mockResolvedValue({ challenge: 'c', rp: {}, user: {}, pubKeyCredParams: [] });

    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_700_000_000_000;
      await beginInstructorRegistration(
        ctx,
        { username: USER, displayName: DISPLAY },
        t0,
      );
      const farFuture = t0 + 10 * 60 * 1_000; // 10 min later, > 5 min TTL
      const result = await completeInstructorRegistration(
        ctx,
        { username: USER, response: {} as never },
        farFuture,
      );
      expect(result.ok).toBe(false);
      expect(mockVerifyReg).not.toHaveBeenCalled();
    });
  });
});

async function registerAndStoreAuthenticator(ctx: any, now: number) {
  mockRegOptions.mockResolvedValue({
    challenge: 'reg-challenge',
    rp: {},
    user: {},
    pubKeyCredParams: [],
  });
  mockVerifyReg.mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: CRED_ID,
        publicKey: PUB_KEY,
        counter: 0,
        transports: ['internal'],
      },
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
    },
  });
  await beginInstructorRegistration(
    ctx,
    { username: USER, displayName: DISPLAY },
    now,
  );
  await completeInstructorRegistration(
    ctx,
    { username: USER, response: {} as never },
    now + 1_000,
  );
}

describe('instructor authentication ceremony', () => {
  it('beginInstructorAuthentication includes registered credentialIds in allowCredentials', async () => {
    mockAuthOptions.mockResolvedValue({
      challenge: 'auth-challenge',
      allowCredentials: [],
    });

    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_700_000_000_000;
      await registerAndStoreAuthenticator(ctx, t0);

      await beginInstructorAuthentication(ctx, { username: USER }, t0 + 60_000);

      const call = mockAuthOptions.mock.calls.at(-1);
      expect(call).toBeDefined();
      const opts = call![0];
      expect(opts.allowCredentials).toHaveLength(1);
      expect(opts.allowCredentials[0].id).toBe(CRED_ID);
    });
  });

  it('beginInstructorAuthentication for an unknown instructor throws', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await expect(
        beginInstructorAuthentication(ctx, { username: 'nobody' }, Date.now()),
      ).rejects.toThrow(/unknown instructor/);
    });
  });

  it('beginInstructorAuthentication without a registered authenticator throws', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      // Insert an instructor without authenticators.
      await ctx.db.insert('instructors', {
        username: USER,
        displayName: DISPLAY,
        createdAt: Date.now(),
      });
      await expect(
        beginInstructorAuthentication(ctx, { username: USER }, Date.now()),
      ).rejects.toThrow(/no registered authenticator/);
    });
  });

  it('completeInstructorAuthentication issues a 12h instructor session and rotates the counter', async () => {
    mockAuthOptions.mockResolvedValue({
      challenge: 'auth-challenge',
      allowCredentials: [],
    });
    mockVerifyAuth.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 7 },
    });

    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_700_000_000_000;
      await registerAndStoreAuthenticator(ctx, t0);
      await beginInstructorAuthentication(ctx, { username: USER }, t0 + 60_000);

      const result = await completeInstructorAuthentication(
        ctx,
        {
          username: USER,
          response: { id: CRED_ID } as never,
        },
        t0 + 61_000,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.expiresAt).toBe(t0 + 61_000 + INSTRUCTOR_SESSION_TTL_MS);

        // Counter rotated on the stored authenticator.
        const auth = await ctx.db
          .query('instructorAuthenticators')
          .withIndex('credentialId', (q) => q.eq('credentialId', CRED_ID))
          .unique();
        expect(auth!.counter).toBe(7);

        // Session row written with role=instructor.
        const session = await getInstructorSession(
          ctx,
          result.token,
          t0 + 70_000,
        );
        expect(session).not.toBeNull();
        expect(session!.role).toBe('instructor');
      }
    });
  });

  it('completeInstructorAuthentication with verified=false issues no session', async () => {
    mockAuthOptions.mockResolvedValue({ challenge: 'c', allowCredentials: [] });
    mockVerifyAuth.mockResolvedValue({ verified: false });

    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_700_000_000_000;
      await registerAndStoreAuthenticator(ctx, t0);
      await beginInstructorAuthentication(ctx, { username: USER }, t0 + 1_000);

      const result = await completeInstructorAuthentication(
        ctx,
        { username: USER, response: { id: CRED_ID } as never },
        t0 + 2_000,
      );
      expect(result.ok).toBe(false);

      const sessions = await ctx.db.query('instructorSessions').collect();
      expect(sessions).toHaveLength(0);
    });
  });

  it('completeInstructorAuthentication for an unknown credentialId is rejected without calling verify', async () => {
    mockAuthOptions.mockResolvedValue({ challenge: 'c', allowCredentials: [] });

    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_700_000_000_000;
      await registerAndStoreAuthenticator(ctx, t0);
      await beginInstructorAuthentication(ctx, { username: USER }, t0 + 1_000);

      const result = await completeInstructorAuthentication(
        ctx,
        { username: USER, response: { id: 'totally-other-id' } as never },
        t0 + 2_000,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('unknown credential');
      expect(mockVerifyAuth).not.toHaveBeenCalled();
    });
  });
});

describe('getInstructorSession', () => {
  it('returns null past expiry', async () => {
    mockAuthOptions.mockResolvedValue({ challenge: 'c', allowCredentials: [] });
    mockVerifyAuth.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    });

    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_700_000_000_000;
      await registerAndStoreAuthenticator(ctx, t0);
      await beginInstructorAuthentication(ctx, { username: USER }, t0 + 1_000);
      const result = await completeInstructorAuthentication(
        ctx,
        { username: USER, response: { id: CRED_ID } as never },
        t0 + 2_000,
      );
      if (!result.ok) throw new Error('setup failed');

      const live = await getInstructorSession(
        ctx,
        result.token,
        t0 + 2_000 + INSTRUCTOR_SESSION_TTL_MS - 1,
      );
      expect(live).not.toBeNull();

      const expired = await getInstructorSession(
        ctx,
        result.token,
        t0 + 2_000 + INSTRUCTOR_SESSION_TTL_MS,
      );
      expect(expired).toBeNull();
    });
  });
});
