import { mutation } from '../../_generated/server';
import { kickEngine } from '../../aiTown/main';

// Public wrapper around aiTown's kickEngine. The upstream `testing:kick`
// is an internalMutation so the instructor-dashboard button can't call
// it directly — hence the proxy here. Re-schedules runStep on the
// default world's engine, getting things ticking again when the engine
// has stalled (the "stop inactive worlds" cron, an unhandled error in
// a prior step, etc.).
export default mutation({
  args: {},
  handler: async (ctx) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('kickEngine: no default world');
    await kickEngine(ctx, status.worldId);
    return { worldId: status.worldId, engineId: status.engineId };
  },
});
