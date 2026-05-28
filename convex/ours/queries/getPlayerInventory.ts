import { v } from 'convex/values';
import { query } from '../../_generated/server';

export default query({
  args: {
    worldId: v.id('worlds'),
    playerId: v.string(),
  },
  handler: async (ctx, args) => {
    const inv = await ctx.db
      .query('agentInventories')
      .withIndex('worldAndPlayer', (q) =>
        q.eq('worldId', args.worldId).eq('playerId', args.playerId)
      )
      .unique();

    if (!inv) return { items: [] };

    // Enrich with item definitions
    const enriched = await Promise.all(
      inv.items.map(async (entry) => {
        const def = await ctx.db.get(entry.itemId);
        return {
          itemId: entry.itemId,
          name: def?.name ?? 'unknown',
          description: def?.description ?? '',
          icon: def?.icon ?? '',
          count: entry.count,
        };
      })
    );

    return { items: enriched };
  },
});