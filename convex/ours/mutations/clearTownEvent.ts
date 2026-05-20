import { v } from 'convex/values';
import { mutation } from '../../_generated/server';

// Clear the active town event: restore each agent's original identity
// (from the snapshot taken at setTownEvent time) and delete the
// townEventState row. Idempotent — no-op if no event is set.
export default mutation({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('townEventState')
      .withIndex('by_world', (q) => q.eq('worldId', args.worldId))
      .unique();
    if (!existing) return { ok: true, restored: 0, alreadyCleared: true };

    let restored = 0;
    for (const [key, originalIdentity] of Object.entries(
      existing.originalIdentities,
    )) {
      // The key is the stringified agentDescription doc _id. We try to
      // restore by patching; if the agent was deleted in the meantime,
      // the patch will throw — we swallow + log to keep the cleanup
      // best-effort.
      try {
        await ctx.db.patch(key as any, { identity: originalIdentity });
        restored += 1;
      } catch (e) {
        console.warn(`clearTownEvent: failed to restore ${key}:`, e);
      }
    }

    await ctx.db.delete(existing._id);
    return { ok: true, restored };
  },
});
