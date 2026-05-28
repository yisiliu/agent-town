import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { internal } from '../../_generated/api';

export default mutation({
  args: {
    worldId: v.id('worlds'),
    fromPlayerId: v.id('players'),
    toPlayerId: v.id('players'),
    itemId: v.id('itemDefinitions'),
    count: v.number(),
  },
  handler: async (ctx, args) => {
    const { worldId, fromPlayerId, toPlayerId, itemId, count } = args;

    if (count <= 0) {
      throw new Error('count must be positive');
    }
    if (fromPlayerId === toPlayerId) {
      throw new Error('cannot transfer to self');
    }

    // Get sender's inventory
    const fromInv = await ctx.db
      .query('agentInventories')
      .withIndex('worldAndPlayer', (q) =>
        q.eq('worldId', worldId).eq('playerId', fromPlayerId)
      )
      .unique();

    const fromCount = fromInv?.items.find((e) => e.itemId === itemId)?.count ?? 0;
    if (fromCount < count) {
      return { success: false, reason: 'insufficient_items' };
    }

    // Remove from sender via internal mutation
    await ctx.runMutation(internal.ours.mutations.addItemToInventory.default, {
      worldId,
      playerId: fromPlayerId,
      itemId,
      count: -count,
    });

    // Add to receiver
    await ctx.runMutation(internal.ours.mutations.addItemToInventory.default, {
      worldId,
      playerId: toPlayerId,
      itemId,
      count,
    });

    return { success: true };
  },
});