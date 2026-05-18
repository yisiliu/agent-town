import { internalAction } from '../../_generated/server';
import { shouldPingRunpod } from '../lib/runpodWarmupCore';
import { warmupPing } from '../lib/runpodClient';

// Spec §3.5 RunPod warm-replica strategy. The cron fires every minute
// during normal hours; this handler decides at each tick whether the
// next scheduled class is close enough to warrant a warmup ping. The
// real "next session start" lookup lives in Task 13's worldStatus
// query — until that lands, the source is a null stub and the cron
// becomes a no-op at every tick (cheap; the spec already covers
// cold-start fallback via the silent-twin path in llmRouter).
export default internalAction({
  args: {},
  handler: async () => {
    const now = Date.now();
    const nextStart = await getNextSessionStartMs();
    if (shouldPingRunpod(now, nextStart)) {
      await warmupPing();
    }
  },
});

// Task 13 will replace this with a ctx.runQuery against the
// sessionWindow worldStatus query. Keeping the call site shape stable
// means that swap is one line — no behavioral change to the cron.
async function getNextSessionStartMs(): Promise<number | null> {
  return null;
}
