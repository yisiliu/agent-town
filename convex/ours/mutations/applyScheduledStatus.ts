import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { applyScheduledStatus } from '../lib/worldState';

// Internal — called by the sessionWindow cron each tick. The cron
// computes the schedule's view of "what state should we be in" and
// passes it here; the lib decides whether to flip the row (respects
// instructor overrides; no-ops when state already matches).
export default internalMutation({
  args: {
    state: v.union(v.literal('live'), v.literal('frozen')),
    nextChange: v.union(v.number(), v.null()),
    nextSessionStart: v.union(v.number(), v.null()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await applyScheduledStatus(ctx, args);
  },
});
