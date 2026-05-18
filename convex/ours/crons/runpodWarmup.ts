import { internalAction } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { shouldPingRunpod } from '../lib/runpodWarmupCore';
import { warmupPing } from '../lib/runpodClient';

// Spec §3.5 RunPod warm-replica strategy. The cron fires every minute;
// this handler decides at each tick whether the next scheduled class
// is close enough to warrant a warmup ping. Source of "next session
// start" is the nextSessionStart internal query, populated by Task 13's
// sessionWindow cron.
export default internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ref = internal as any;
    const nextStart = (await ctx.runQuery(
      ref.ours.queries.nextSessionStart.default,
      {},
    )) as number | null;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (shouldPingRunpod(now, nextStart)) {
      await warmupPing();
    }
  },
});
