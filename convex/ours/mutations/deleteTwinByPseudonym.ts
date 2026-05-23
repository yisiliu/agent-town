import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { insertInput } from '../../aiTown/insertInput';

// Full-removal of a twin: deletes its card + twin row and issues a
// `leave` input for any matching live player in the default world.
// Public mutation so the instructor dashboard (or CLI) can call it
// directly without needing a dedicated UI flow.
export default mutation({
  args: { pseudonym: v.string() },
  handler: async (ctx, { pseudonym }) => {
    const twins = await ctx.db
      .query('twins')
      .withIndex('pseudonym', (q) => q.eq('pseudonym', pseudonym))
      .collect();
    if (twins.length === 0) {
      return { found: 0, deleted: 0, leavesIssued: 0 };
    }

    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();

    let leavesIssued = 0;
    if (status) {
      const descs = await ctx.db
        .query('playerDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', status.worldId))
        .filter((q) => q.eq(q.field('name'), pseudonym))
        .collect();
      for (const d of descs) {
        try {
          await insertInput(ctx, status.worldId, 'leave', {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            playerId: d.playerId as any,
          });
          leavesIssued++;
        } catch {
          // player already gone — keep going
        }
      }
    }

    let deleted = 0;
    for (const t of twins) {
      if (t.cardId) {
        try { await ctx.db.delete(t.cardId); } catch { /* card already gone */ }
      }
      await ctx.db.delete(t._id);
      deleted++;
    }

    return { found: twins.length, deleted, leavesIssued };
  },
});
