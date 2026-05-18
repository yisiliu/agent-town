import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Singleton state row holding the town's current live/frozen status.
// `lastChangedBy` records whether the most recent flip came from the
// cron applying the schedule or from an instructor manual override —
// the cron uses this to know whether it owns the row this tick.
export const worldState = defineTable({
  state: v.union(v.literal('live'), v.literal('frozen')),
  nextChange: v.union(v.number(), v.null()),
  nextSessionStart: v.union(v.number(), v.null()),
  lastChangedAt: v.number(),
  lastChangedBy: v.union(v.literal('cron'), v.literal('instructor')),
});
