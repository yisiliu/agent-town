import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server';
import type { DataModelFromSchemaDefinition } from 'convex/server';
import type schema from '../../schema';
import { generate6DigitCode, hashCode, verifyCodeHash } from './codes';

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
type MutationCtx = GenericMutationCtx<DataModel>;
type QueryCtx = GenericQueryCtx<DataModel>;
type TwinId = DataModel['twins']['document']['_id'];
type Scope = 'spectate' | 'control' | 'edit';

export async function issueCodeFor(
  ctx: MutationCtx,
  twinId: TwinId,
  scope: Scope,
): Promise<{ plaintext: string }> {
  const plaintext = generate6DigitCode();
  const hash = await hashCode(plaintext);

  const existing = await ctx.db
    .query('authCodes')
    .withIndex('twin_scope', (q) => q.eq('twinId', twinId).eq('scope', scope))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      hash,
      issuedAt: Date.now(),
      reissueCountThisSemester: existing.reissueCountThisSemester + 1,
    });
  } else {
    await ctx.db.insert('authCodes', {
      twinId,
      scope,
      hash,
      issuedAt: Date.now(),
      reissueCountThisSemester: 0,
    });
  }

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
