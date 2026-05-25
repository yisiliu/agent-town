import type { GenericMutationCtx } from 'convex/server';
import type { DataModel, Id } from '../../_generated/dataModel';

type Ctx = GenericMutationCtx<DataModel>;

export async function clearTownEventForWorld(
  ctx: Ctx,
  worldId: Id<'worlds'>,
): Promise<{ ok: true; restored: number; alreadyCleared?: boolean }> {
  const existing = await ctx.db
    .query('townEventState')
    .withIndex('by_world', (q) => q.eq('worldId', worldId))
    .unique();
  if (!existing) return { ok: true, restored: 0, alreadyCleared: true };

  let restored = 0;
  for (const [key, originalIdentity] of Object.entries(existing.originalIdentities)) {
    try {
      await ctx.db.patch(key as Id<'agentDescriptions'>, { identity: originalIdentity });
      restored += 1;
    } catch (e) {
      console.warn(`clearTownEvent: failed to restore ${key}:`, e);
    }
  }

  await ctx.db.delete(existing._id);
  return { ok: true, restored };
}
