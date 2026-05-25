import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Singleton row tracking what the engine watchdog cron last saw.
// Used to detect "running=true but actually dead" — Convex transient
// platform events (container restart, deploy, scaling) can kill an
// in-flight runStep before its try/catch fires, leaving no
// next-runStep scheduled and the engine sitting with running=true
// forever. Watchdog compares engine.generationNumber against this
// snapshot every minute; if it hasn't moved, force-revive.
export const engineWatchdog = defineTable({
  lastSeenGen: v.number(),
  lastSeenAt: v.number(),
  // How many consecutive cron checks have seen gen unchanged. We
  // require 2 in a row before reviving so a single slow frozen-mode
  // tick (stepDuration=10s + scheduler slack) doesn't trip a false
  // alarm. With cron at 1-minute cadence: 2 unchanged = 120s of no
  // tick = engine actually dead.
  unchangedCount: v.optional(v.number()),
  // Diagnostic: how many times we've had to revive. Lets us monitor
  // platform health without a separate metrics pipeline.
  reviveCount: v.number(),
  lastReviveAt: v.optional(v.number()),
});
