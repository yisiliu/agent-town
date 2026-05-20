import { query } from '../../_generated/server';

// Public version of listActiveInteractions for the instructor dashboard.
// Returns lightweight summary fields (skips opaque state JSON which can
// be large) so the dashboard list renders fast.
export default query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('interactions')
      .order('desc')
      .take(20);
    return rows.map((r) => ({
      _id: r._id,
      type: r.type,
      status: r.status,
      phase: r.phase,
      turnIndex: r.turnIndex,
      participantCount: r.participants.length,
      originType: r.originType ?? 'standalone',
      worldId: r.worldId,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      winner: r.winner,
    }));
  },
});
