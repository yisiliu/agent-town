import { internalAction, internalMutation } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { stopEngine, startEngine } from '../../aiTown/main';
import { v } from 'convex/values';

// Self-heal cron. Convex transient platform events (deploys, scaling,
// container restart) can kill an in-flight runStep BEFORE its
// try/catch runs — duration=0ms, "Transient error while executing
// action". Since runStep schedules its successor at the END of the
// handler, a mid-action kill leaves engine.running=true but no next
// tick ever fires. The engine looks alive but is dead.
//
// Detection: read engine.generationNumber (which increments on every
// successful runStep save). If it hasn't moved since the previous
// cron tick AND engine.running=true → revive.
//
// Revive: stop+start cycle (same as devForceResumeWorld). This also
// jumps engine.currentTime to wall-clock now, fixing the
// maxTicksPerStep-induced in-game-time lag in one go.
//
// Cron cadence: every 1 minute. Worst-case death-to-detection is ~2
// minutes (first tick records baseline, second tick finds it stuck).
// In live mode (2.5s stepDuration), gen advances ~20×/min — single
// missed advancement is conclusive. In frozen mode (30s
// stepDuration), gen advances ~1-2×/min — still always > 0 when
// alive, so single-tick detection still works.

interface SnapshotResult {
  needRevive: boolean;
  reason: string;
  gen: number;
  reviveCount: number;
  worldId?: string;
}

export const snapshotAndDecide = internalMutation({
  args: {},
  handler: async (ctx): Promise<SnapshotResult> => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) {
      return { needRevive: false, reason: 'no default world', gen: 0, reviveCount: 0 };
    }
    const engine = await ctx.db.get(status.engineId);
    if (!engine) {
      return { needRevive: false, reason: 'no engine row', gen: 0, reviveCount: 0 };
    }
    const wd = await ctx.db.query('engineWatchdog').first();
    const now = Date.now();
    const gen = engine.generationNumber;
    const reviveCount = wd?.reviveCount ?? 0;

    // First-ever run: just record the baseline.
    if (!wd) {
      await ctx.db.insert('engineWatchdog', {
        lastSeenGen: gen,
        lastSeenAt: now,
        unchangedCount: 0,
        reviveCount: 0,
      });
      return { needRevive: false, reason: 'baseline set', gen, reviveCount: 0 };
    }

    // Engine intentionally stopped — don't fight the instructor.
    if (!engine.running) {
      await ctx.db.patch(wd._id, { lastSeenGen: gen, lastSeenAt: now, unchangedCount: 0 });
      return { needRevive: false, reason: 'engine stopped (running=false)', gen, reviveCount };
    }

    // Healthy: gen advanced since last check.
    if (gen > wd.lastSeenGen) {
      await ctx.db.patch(wd._id, {
        lastSeenGen: gen,
        lastSeenAt: now,
        unchangedCount: 0,
      });
      return { needRevive: false, reason: `healthy (+${gen - wd.lastSeenGen} ticks)`, gen, reviveCount };
    }

    // Same gen as last check. Bump unchanged counter. Revive only on
    // the SECOND consecutive zero — protects frozen mode (30s/tick)
    // from false alarms when a cron sample lands between ticks.
    const unchanged = (wd.unchangedCount ?? 0) + 1;
    if (unchanged < 2) {
      await ctx.db.patch(wd._id, { unchangedCount: unchanged });
      return {
        needRevive: false,
        reason: `gen unchanged once (waiting for 2nd confirmation)`,
        gen,
        reviveCount,
      };
    }

    return {
      needRevive: true,
      reason: `gen frozen at ${gen} for ${unchanged} consecutive checks (~${unchanged * 60}s)`,
      gen,
      reviveCount,
      worldId: status.worldId as unknown as string,
    };
  },
});

export const recordRevive = internalMutation({
  args: { gen: v.number(), worldId: v.id('worlds') },
  handler: async (ctx, args) => {
    const wd = await ctx.db.query('engineWatchdog').first();
    if (!wd) return;
    const now = Date.now();
    await ctx.db.patch(wd._id, {
      lastSeenGen: args.gen,
      lastSeenAt: now,
      unchangedCount: 0,
      reviveCount: (wd.reviveCount ?? 0) + 1,
      lastReviveAt: now,
    });
  },
});

export const reviveEngine = internalMutation({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => {
    // Mirror devForceResumeWorld's stop+start dance. stopEngine throws
    // if already stopped; guard with a state check.
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('worldId'), args.worldId))
      .first();
    if (!status) return;
    const engine = await ctx.db.get(status.engineId);
    if (engine?.running) {
      await stopEngine(ctx, args.worldId);
    }
    await startEngine(ctx, args.worldId);
  },
});

/* eslint-disable @typescript-eslint/no-explicit-any */
export default internalAction({
  args: {},
  handler: async (ctx) => {
    const result: SnapshotResult = await ctx.runMutation(
      internal.ours.crons.engineWatchdog.snapshotAndDecide as any,
      {},
    );

    if (!result.needRevive) {
      // Quiet on the happy path — cron fires every minute, we don't
      // want to spam logs.
      return result;
    }

    console.warn(
      `engineWatchdog reviving: ${result.reason}. Total revives so far: ${result.reviveCount}`,
    );
    if (result.worldId) {
      await ctx.runMutation(
        internal.ours.crons.engineWatchdog.reviveEngine as any,
        { worldId: result.worldId },
      );
      await ctx.runMutation(
        internal.ours.crons.engineWatchdog.recordRevive as any,
        { worldId: result.worldId, gen: result.gen },
      );
    }
    return result;
  },
});
