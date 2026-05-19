import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server';
import type { DataModelFromSchemaDefinition } from 'convex/server';
import type schema from '../../schema';
import { generate6DigitCode, hashCode, verifyCodeHash } from './codes';

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
type MutationCtx = GenericMutationCtx<DataModel>;
type QueryCtx = GenericQueryCtx<DataModel>;
type TwinId = DataModel['twins']['document']['_id'];
type Scope = 'spectate' | 'control' | 'edit';

export interface PreparedCode {
  plaintext: string;
  hash: string;
}

// Generate + bcrypt-hash a new code WITHOUT touching the database.
// Splits the prior issueCodeFor into a bcrypt-needing step (runs in
// Node action runtime — bcryptjs uses setTimeout which the Convex V8
// mutation/query runtime forbids) and a write-only step.
export async function prepareCode(): Promise<PreparedCode> {
  const plaintext = generate6DigitCode();
  const hash = await hashCode(plaintext);
  return { plaintext, hash };
}

// Pure DB write — runs fine inside a V8 mutation. Replaces any prior
// row for the (twinId, scope) tuple.
export async function writePreparedCode(
  ctx: MutationCtx,
  twinId: TwinId,
  scope: Scope,
  hash: string,
  now: number,
): Promise<void> {
  const existing = await ctx.db
    .query('authCodes')
    .withIndex('twin_scope', (q) => q.eq('twinId', twinId).eq('scope', scope))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      hash,
      issuedAt: now,
      reissueCountThisSemester: existing.reissueCountThisSemester + 1,
    });
  } else {
    await ctx.db.insert('authCodes', {
      twinId,
      scope,
      hash,
      issuedAt: now,
      reissueCountThisSemester: 0,
    });
  }
}

// Convenience wrapper kept for tests + future single-call sites that
// run in a Node-capable context. Callers in V8 mutation/query runtimes
// MUST instead call prepareCode() in an action and writePreparedCode()
// in a mutation.
export async function issueCodeFor(
  ctx: MutationCtx,
  twinId: TwinId,
  scope: Scope,
): Promise<{ plaintext: string }> {
  const { plaintext, hash } = await prepareCode();
  await writePreparedCode(ctx, twinId, scope, hash, Date.now());
  return { plaintext };
}

export async function verifyCodeFor(
  ctx: QueryCtx,
  twinId: TwinId,
  scope: Scope,
  plaintext: string,
): Promise<boolean> {
  const row = await ctx.db
    .query('authCodes')
    .withIndex('twin_scope', (q) => q.eq('twinId', twinId).eq('scope', scope))
    .unique();
  if (!row) return false;
  return verifyCodeHash(plaintext, row.hash);
}
