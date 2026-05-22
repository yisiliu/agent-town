import { query } from '../../_generated/server';

// Diagnostic: list every playerDescription on the default world.
export default query({
  args: {},
  handler: async (ctx) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return { worldId: null, names: [] };
    const all = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', status.worldId))
      .collect();
    return {
      worldId: status.worldId,
      total: all.length,
      names: all.map((p) => p.name).sort(),
    };
  },
});
