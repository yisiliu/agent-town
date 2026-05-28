import { v } from 'convex/values';
import { mutation } from '../../_generated/server';

export default mutation({
  args: {
    worldId: v.id('worlds'),
    playerId: v.id('players'),
    itemId: v.id('itemDefinitions'),
    count: v.number(),
  },
  handler: async (ctx, args) => {
    const { worldId, playerId, itemId, count } = args;

    // Find or create inventory for this player
    const existing = await ctx.db
      .query('agentInventories')
      .withIndex('worldAndPlayer', (q) =>
        q.eq('worldId', worldId).eq('playerId', playerId)
      )
      .unique();

    if (!existing) {
      // Create new inventory
      await ctx.db.insert('agentInventories', {
        worldId,
        playerId,
        items: count > 0 ? [{ itemId, count }] : [],
      });
      return { success: true, newTotal: Math.max(0, count) };
    }

    // Update existing inventory
    const items = [...existing.items];
    const idx = items.findIndex((e) => e.itemId === itemId);
    if (idx >= 0) {
      items[idx] = { itemId, count: Math.max(0, items[idx].count + count) };
    } else if (count > 0) {
      items.push({ itemId, count });
    }

    // Filter out zero-count items
    const filtered = items.filter((e) => e.count > 0);
    await ctx.db.patch(existing._id, { items: filtered });

    const newTotal = filtered.find((e) => e.itemId === itemId)?.count ?? 0;
    return { success: true, newTotal };
  },
});