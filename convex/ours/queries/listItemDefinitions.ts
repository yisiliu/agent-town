import { v } from 'convex/values';
import { query } from '../../_generated/server';

export default query({
  args: {
    category: v.optional(
      v.union(
        v.literal('seed'),
        v.literal('crop'),
        v.literal('food'),
        v.literal('material'),
        v.literal('misc'),
      )
    ),
  },
  handler: async (ctx, args) => {
    let q = ctx.db.query('itemDefinitions');
    if (args.category) {
      q = q.withIndex('category', (q) => q.eq('category', args.category));
    }
    const items = await q.collect();
    return items.map((item) => ({
      itemId: item._id,
      name: item.name,
      description: item.description,
      icon: item.icon,
      category: item.category,
      tradeable: item.tradeable,
    }));
  },
});