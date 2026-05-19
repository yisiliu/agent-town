import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';

// Helper for the takeTurn action to clear inflightSince on early-exit
// paths (status not in_progress, no plan, etc.) so the cron can pick
// the interaction up cleanly on the next heartbeat.
export default internalMutation({
  args: {
    interactionId: v.id('interactions'),
    inflightSince: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.interactionId, {
      inflightSince: args.inflightSince === null ? undefined : args.inflightSince,
    });
  },
});
