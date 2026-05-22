import { query } from '../../_generated/server';

export default query({
  args: {},
  handler: async (ctx) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return { error: 'no default world' };
    const engine = await ctx.db.get(status.engineId);
    return {
      worldId: status.worldId,
      engineId: status.engineId,
      worldStatus: status.status,
      engine: engine ?? null,
      now: Date.now(),
    };
  },
});
