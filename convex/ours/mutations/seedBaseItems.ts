import { mutation } from '../../_generated/server';

// Seed 5 base items into itemDefinitions table.
// Idempotent — safe to run multiple times.
export default mutation({
  args: {},
  handler: async (ctx) => {
    const items = [
      { name: '种子', description: '可以种在农田里的种子', icon: '🌱', category: 'seed' as const, tradeable: true },
      { name: '小麦', description: '成熟的农作物，可以磨成面粉', icon: '🌾', category: 'crop' as const, tradeable: true },
      { name: '面包', description: '由面粉制成的食物', icon: '🍞', category: 'food' as const, tradeable: true },
      { name: '铁矿', description: '可用于制作工具的矿物', icon: '🪨', category: 'material' as const, tradeable: true },
      { name: '苹果', description: '新鲜的水果', icon: '🍎', category: 'food' as const, tradeable: true },
    ];

    const results = [];
    for (const item of items) {
      const existing = await ctx.db
        .query('itemDefinitions')
        .withIndex('name', (q) => q.eq('name', item.name))
        .unique();
      if (existing) {
        results.push({ name: item.name, status: 'already_exists', id: existing._id });
      } else {
        const id = await ctx.db.insert('itemDefinitions', item);
        results.push({ name: item.name, status: 'created', id });
      }
    }
    return results;
  },
});