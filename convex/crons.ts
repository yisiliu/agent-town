import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

// Convex cron registry. Future tasks (13: sessionWindow, 17: buildDigest,
// 31: processDeleteQueue) extend this file with their own schedules.
const crons = cronJobs();

/* eslint-disable @typescript-eslint/no-explicit-any */
const ref = internal as any;

// Spec §3.5 — keep the RunPod replica warm in the run-up to each
// scheduled class. The handler is a no-op outside the 5-min lead
// window so the cron itself is cheap to run at this cadence.
crons.interval(
  'runpod-warmup',
  { minutes: 1 },
  ref.ours.crons.runpodWarmup.default,
);
/* eslint-enable @typescript-eslint/no-explicit-any */

export default crons;
