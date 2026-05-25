import { internalQuery } from '../../_generated/server';

// Picks up active interactions ordered by stalest tick first (so the cron
// catches up oldest games first if backed up). Bounded at 50 — comfortable
// upper bound for v1 classroom use (10 concurrent games × 5 players).
export default internalQuery({
  args: {},
  handler: async (ctx) => {
    // Both 'in_progress' (turn-taking) and 'gathering' (staged borrow) games
    // need ticking. A single `.eq` on the status index can't disjunct, so
    // run two indexed queries and merge stalest-first.
    const inProgress = await ctx.db
      .query('interactions')
      .withIndex('by_status_and_lastTickAt', (q) => q.eq('status', 'in_progress'))
      .take(50);
    const gathering = await ctx.db
      .query('interactions')
      .withIndex('by_status_and_lastTickAt', (q) => q.eq('status', 'gathering'))
      .take(50);
    return [...inProgress, ...gathering]
      .sort((a, b) => a.lastTickAt - b.lastTickAt)
      .slice(0, 50);
  },
});
