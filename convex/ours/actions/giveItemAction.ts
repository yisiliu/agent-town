import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { internal } from '../../_generated/api';

export default action({
  args: {
    worldId: v.id('worlds'),
    fromPlayerId: v.id('players'),
    toPlayerId: v.id('players'),
    itemId: v.id('itemDefinitions'),
    count: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.count <= 0) {
      return { success: false, reason: 'invalid_count' };
    }
    if (args.fromPlayerId === args.toPlayerId) {
      return { success: false, reason: 'self_transfer' };
    }

    // Check giver's inventory
    const fromInv = await ctx.runQuery(internal.ours.queries.getPlayerInventory.default, {
      worldId: args.worldId,
      playerId: args.fromPlayerId,
    });

    const entry = fromInv.items.find((e: any) => e.itemId === args.itemId);
    const fromCount = entry?.count ?? 0;
    if (fromCount < args.count) {
      return { success: false, reason: 'insufficient_items' };
    }

    // Transfer via mutation
    await ctx.runMutation(internal.ours.mutations.addItemToInventory.default, {
      worldId: args.worldId,
      playerId: args.fromPlayerId,
      itemId: args.itemId,
      count: -args.count,
    });
    await ctx.runMutation(internal.ours.mutations.addItemToInventory.default, {
      worldId: args.worldId,
      playerId: args.toPlayerId,
      itemId: args.itemId,
      count: args.count,
    });

    return { success: true };
  },
});