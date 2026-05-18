// Pure decision logic for the spec §3.5 warmup cron. The Convex cron in
// ours/crons/runpodWarmup wires this to a real session-start source
// (Task 13's `sessionWindow` query) + the runpodClient ping. Splitting
// the predicate out makes the timing math testable without a Convex
// runtime or wall clock.

export const WARMUP_LEAD_MS = 5 * 60 * 1_000;
// Cron typically fires every 1 minute; widen the window to ±1 min so
// timing jitter never causes us to miss the lead-time mark. Multiple
// pings in the window are cost-free — they just keep the pod warm.
export const WARMUP_TOLERANCE_MS = 60 * 1_000;

export function shouldPingRunpod(
  now: number,
  nextSessionStartMs: number | null,
): boolean {
  if (nextSessionStartMs === null) return false;
  const delta = nextSessionStartMs - now;
  return (
    delta >= WARMUP_LEAD_MS - WARMUP_TOLERANCE_MS &&
    delta <= WARMUP_LEAD_MS + WARMUP_TOLERANCE_MS
  );
}
