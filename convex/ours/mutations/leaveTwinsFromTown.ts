import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { insertInput } from '../../aiTown/insertInput';

// Bulk-leave from the in-world player set. Takes an array of twinIds,
// finds each twin's pseudonym, looks up matching live players in
// playerDescriptions, and issues a `leave` input for each. Twin state
// is NOT changed — re-promoting via the dashboard puts them back in.

export default mutation({
  args: { twinIds: v.array(v.id('twins')) },
  handler: async (ctx, { twinIds }) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) {
      return { leavesIssued: 0, twinsProcessed: 0, error: 'no default world' as const };
    }
    const worldId = status.worldId;

    let leavesIssued = 0;
    const processed: { twinId: string; pseudonym: string; leaves: number }[] = [];
    for (const twinId of twinIds) {
      const twin = await ctx.db.get(twinId);
      if (!twin) continue;
      const descs = await ctx.db
        .query('playerDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', worldId))
        .filter((q) => q.eq(q.field('name'), twin.pseudonym))
        .collect();
      let count = 0;
      for (const d of descs) {
        try {
          await insertInput(ctx, worldId, 'leave', {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            playerId: d.playerId as any,
          });
          count++;
          leavesIssued++;
        } catch {
          // already gone — keep going
        }
      }
      processed.push({
        twinId: twin._id as unknown as string,
        pseudonym: twin.pseudonym,
        leaves: count,
      });
    }

    return { leavesIssued, twinsProcessed: processed.length, processed };
  },
});
