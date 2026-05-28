import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { itemDefinitions } from '../tables/itemDefinitions';

export default mutation({
  args: {
    name: v.string(),
    description: v.string(),
    icon: v.optional(v.string()),
    category: v.union(
      v.literal('seed'),
      v.literal('crop'),
      v.literal('food'),
      v.literal('material'),
      v.literal('misc'),
    ),
    tradeable: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('itemDefinitions')
      .withIndex('name', (q) => q.eq('name', args.name))
      .unique();
    if (existing) {
      // Update existing item definition
      await ctx.db.patch(existing._id, {
        description: args.description,
        icon: args.icon,
        category: args.category,
        tradeable: args.tradeable,
      });
      return { inserted: false, updated: true, itemId: existing._id };
    }
    const itemId = await ctx.db.insert('itemDefinitions', {
      name: args.name,
      description: args.description,
      icon: args.icon,
      category: args.category,
      tradeable: args.tradeable,
    });
    return { inserted: true, updated: false, itemId };
  },
});