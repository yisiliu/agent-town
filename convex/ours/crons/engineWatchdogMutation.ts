import { internalMutation } from '../../_generated/server';
import { stopEngine, startEngine } from '../../aiTown/main';
import { isTownInert } from '../lib/watchdogWedge';

// Mutation-based watchdog. Convex auto-retries mutations on transient
// platform errors, but NOT actions (see docs.convex.dev/scheduling).
// The action-based watchdog (../crons/engineWatchdog.ts) was getting
// killed by the same transient bursts it was supposed to recover from
// — every cron action on this deployment has been failing 0ms-
// transient since 2026-05-22 14:04. By doing the watchdog work in a
// mutation we get Convex's exactly-once delivery guarantee for free.
//
// What this does:
//   1. Read engine.generationNumber
//   2. Compare to last-seen gen recorded in engineWatchdog table
//   3. If running=true AND gen unchanged for 2 consecutive checks
//      (~120s of no tick) → stop+start cycle to revive
//
// stopEngine/startEngine are helper functions (not actions) exported
// from aiTown/main.ts — both do db.patch + scheduler.runAfter. Safe
// to call from a mutation handler.

export default internalMutation({
  args: {},
  handler: async (ctx) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return { skipped: 'no default world' };

    const engine = await ctx.db.get(status.engineId);
    if (!engine) return { skipped: 'no engine row' };

    const wd = await ctx.db.query('engineWatchdog').first();
    const now = Date.now();
    const gen = engine.generationNumber;
    const reviveCount = wd?.reviveCount ?? 0;

    if (!wd) {
      await ctx.db.insert('engineWatchdog', {
        lastSeenGen: gen,
        lastSeenAt: now,
        unchangedCount: 0,
        reviveCount: 0,
      });
      return { action: 'baseline-set', gen };
    }

    if (!engine.running) {
      await ctx.db.patch(wd._id, { lastSeenGen: gen, lastSeenAt: now, unchangedCount: 0, wedgedCount: 0 });
      return { action: 'engine-intentionally-stopped', gen };
    }

    if (gen > wd.lastSeenGen) {
      // Engine is alive (ticking). But check for a "running but inert" town:
      // nobody conversing AND nobody moving — the symptom of "all conversations
      // stopped" (agents left on stale inProgressOperations after a deploy/
      // restart). ai-town's own ACTION_TIMEOUT recovery is in sim-time and
      // barely advances when frozen, so it never self-heals. Recover with a
      // stop+start: startEngine jumps currentTime to now, clearing the stale
      // ops on the next tick so agents re-fire (verified to work at frozen).
      const world = await ctx.db.get(status.worldId);
      if (world && isTownInert(world)) {
        const wedgedCount = (wd.wedgedCount ?? 0) + 1;
        if (wedgedCount < 2) {
          await ctx.db.patch(wd._id, { lastSeenGen: gen, lastSeenAt: now, unchangedCount: 0, wedgedCount });
          return { action: 'wedge-wait-for-confirmation', gen, wedgedCount };
        }
        await stopEngine(ctx, status.worldId);
        await startEngine(ctx, status.worldId);
        await ctx.db.patch(wd._id, {
          lastSeenGen: gen, lastSeenAt: now, unchangedCount: 0, wedgedCount: 0,
          reviveCount: reviveCount + 1, lastReviveAt: now,
        });
        console.warn(
          `engineWatchdog un-wedged: all agents stuck on inProgressOperation for ${wedgedCount} checks. Total revives: ${reviveCount + 1}`,
        );
        return { action: 'unwedged', gen, reviveCount: reviveCount + 1 };
      }
      await ctx.db.patch(wd._id, {
        lastSeenGen: gen,
        lastSeenAt: now,
        unchangedCount: 0,
        wedgedCount: 0,
      });
      return { action: 'healthy', gen, advance: gen - wd.lastSeenGen, reviveCount };
    }

    // Same gen as last check — bump counter, only revive on 2nd consecutive.
    const unchanged = (wd.unchangedCount ?? 0) + 1;
    if (unchanged < 2) {
      // Reset wedgedCount too: a gen-freeze here means this check is NOT a
      // confirmed wedge observation, so it must break the "2 consecutive
      // wedge checks" chain rather than let a stale count of 1 carry over.
      await ctx.db.patch(wd._id, { unchangedCount: unchanged, wedgedCount: 0 });
      return { action: 'wait-for-confirmation', gen, unchanged };
    }

    // Revive.
    if (engine.running) {
      await stopEngine(ctx, status.worldId);
    }
    await startEngine(ctx, status.worldId);
    await ctx.db.patch(wd._id, {
      lastSeenGen: gen,
      lastSeenAt: now,
      unchangedCount: 0,
      wedgedCount: 0,
      reviveCount: reviveCount + 1,
      lastReviveAt: now,
    });
    console.warn(
      `engineWatchdog revived: gen frozen at ${gen} for ${unchanged} checks. Total revives: ${reviveCount + 1}`,
    );
    return { action: 'revived', gen, reviveCount: reviveCount + 1 };
  },
});
