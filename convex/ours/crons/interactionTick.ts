import { internalAction } from '../../_generated/server';
import { internal } from '../../_generated/api';
import type { Doc } from '../../_generated/dataModel';

// Heartbeat for the Interactions framework. Fires every minute; sub-minute
// cadence comes from the takeTurn action's self-scheduled chain (+2s × 5).
// The cron's job is to pick up:
//   - freshly-started interactions (lastTickAt === 0)
//   - games whose chain ended without reaching `ended` (took 5 turns and yielded)
//   - games where a takeTurn invocation died mid-flight (inflightSince stale)
//
// Dedup uses `inflightSince`. Set on schedule; cleared by appendInteractionTurn
// (or by the action's early-exit helper). If a process crashed mid-action,
// `inflightSince` could remain set — we treat it as stale after 90s so a
// stuck game eventually recovers.
const STALE_INFLIGHT_MS = 90_000;
const TICK_DEBOUNCE_MS = 5_000;

export default internalAction({
  args: {},
  handler: async (ctx) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ref = internal as any;
    const now = Date.now();

    const active = (await ctx.runQuery(
      ref.ours.queries.listActiveInteractions.default,
      {},
    )) as Doc<'interactions'>[];

    for (const inter of active) {
      // Recently ticked → skip.
      if (inter.lastTickAt && now - inter.lastTickAt < TICK_DEBOUNCE_MS) continue;
      // Action already in flight → skip unless stale.
      if (
        inter.inflightSince &&
        now - inter.inflightSince < STALE_INFLIGHT_MS
      ) {
        continue;
      }

      await ctx.runMutation(ref.ours.mutations.setInteractionInflight.default, {
        interactionId: inter._id,
        inflightSince: now,
      });
      await ctx.scheduler.runAfter(
        0,
        ref.ours.actions.interactionTakeTurn.default,
        { interactionId: inter._id, chainCount: 0 },
      );
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
  },
});
