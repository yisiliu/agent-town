import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

// Convex cron registry. Future tasks (13: sessionWindow, 17: buildDigest,
// 31: processDeleteQueue) extend this file with their own schedules.
const crons = cronJobs();

/* eslint-disable @typescript-eslint/no-explicit-any */
const ref = internal as any;

// Spec §3.2 — auto-resume/freeze the town at scheduled session
// boundaries. Runs every minute; handler is cheap (one config-driven
// computation + one mutation, no-op when state already matches).
crons.interval(
  'session-window',
  { minutes: 1 },
  ref.ours.crons.sessionWindow.default,
);
/* eslint-enable @typescript-eslint/no-explicit-any */

export default crons;
