import type {
  DataModelFromSchemaDefinition,
  GenericMutationCtx,
  GenericQueryCtx,
} from 'convex/server';
import type schema from '../../schema';

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
type MutationCtx = GenericMutationCtx<DataModel>;
type QueryCtx = GenericQueryCtx<DataModel>;
type TwinId = DataModel['twins']['document']['_id'];
type Scope = 'spectate' | 'control' | 'edit';

// 24h per spec §8.2.
export const SESSION_TTL_MS = 24 * 60 * 60 * 1_000;

// 32 bytes of entropy → 256 bits, encoded as base64url. The padding
// gets stripped because the token is an exact-match index lookup and
// '=' would be needlessly conspicuous in URLs / logs.
function generateToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  // btoa accepts a binary string; build one byte-at-a-time.
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface SessionRecord {
  twinId: TwinId;
  scope: Scope;
  expiresAt: number;
}

export async function createSession(
  ctx: MutationCtx,
  twinId: TwinId,
  scope: Scope,
  now: number,
  opts: { ip?: string } = {},
): Promise<{ token: string; expiresAt: number }> {
  const token = generateToken();
  const expiresAt = now + SESSION_TTL_MS;
  await ctx.db.insert('studentSessions', {
    token,
    twinId,
    scope,
    issuedAt: now,
    expiresAt,
    createdFromIp: opts.ip,
  });
  return { token, expiresAt };
}

export async function getSession(
  ctx: QueryCtx,
  token: string,
  now: number,
): Promise<SessionRecord | null> {
  const row = await ctx.db
    .query('studentSessions')
    .withIndex('token', (q) => q.eq('token', token))
    .unique();
  if (!row) return null;
  if (now >= row.expiresAt) return null;
  return { twinId: row.twinId, scope: row.scope, expiresAt: row.expiresAt };
}

export async function revokeSession(
  ctx: MutationCtx,
  token: string,
): Promise<void> {
  const row = await ctx.db
    .query('studentSessions')
    .withIndex('token', (q) => q.eq('token', token))
    .unique();
  if (row) await ctx.db.delete(row._id);
}
