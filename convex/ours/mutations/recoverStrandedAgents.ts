import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { stopEngine, startEngine } from '../../aiTown/main';

// One-off prod recovery for agents stranded at HIDDEN_COORD (-9999) after a
// dungeon/werewolf game ended while the town engine was LIVE. Root cause: the
// engine `db.replace`s the whole world from its in-memory snapshot every
// runStep, so the interaction's direct world.players restore got clobbered by
// an in-flight runStep, and the dungeonReturnState rows were deleted (saved
// positions lost). See the dungeon-bridge fix.
//
// Recovery sequence (run in order, with a wait after `halt`):
//   1. halt      — stopEngine + bump generationNumber (kills any in-flight
//                  runStep at its next saveStep so it can't clobber).
//   2. (wait ~15s for the engine to go idle — generationNumber stops moving)
//   3. reposition {dryRun:true} then reposition {}  — teleport -9999 players
//      to valid on-map coords (originals are lost; scatter near a live agent).
//   4. resume    — startEngine (loads the repositioned world, perpetuates it).
const HIDDEN = -9999;

export const halt = internalMutation({
  args: {},
  handler: async (ctx) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return { error: 'no default world' as const };
    await stopEngine(ctx, status.worldId);
    // Invalidate any in-flight runStep so its next saveStep aborts (OCC).
    const engine = await ctx.db.get(status.engineId);
    if (engine) {
      await ctx.db.patch(status.engineId, {
        generationNumber: engine.generationNumber + 1,
      });
    }
    return { halted: true as const, engineId: status.engineId };
  },
});

export const reposition = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return { error: 'no default world' as const };
    const world = await ctx.db.get(status.worldId);
    if (!world) return { error: 'no world doc' as const };

    const players = world.players.map((p) => ({ ...p }));
    const stranded = players.filter((p) => p.position.x === HIDDEN);
    // Anchor near a currently-valid agent; fall back to a safe map coord.
    const ref = players.find((p) => p.position.x !== HIDDEN);
    const anchor = ref ? { x: ref.position.x, y: ref.position.y } : { x: 8, y: 8 };

    const ids: string[] = [];
    stranded.forEach((p, i) => {
      ids.push(p.id);
      if (dryRun) return;
      const idx = players.findIndex((q) => q.id === p.id);
      players[idx] = {
        ...players[idx]!,
        position: { x: anchor.x + (i % 4), y: anchor.y + Math.floor(i / 4) },
        pathfinding: undefined,
        activity: undefined,
        speed: 0,
      };
    });

    if (!dryRun && stranded.length > 0) {
      await ctx.db.patch(status.worldId, { players });
    }
    return { dryRun: !!dryRun, strandedCount: stranded.length, ids, anchor };
  },
});

export const resume = internalMutation({
  args: {},
  handler: async (ctx) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return { error: 'no default world' as const };
    await startEngine(ctx, status.worldId);
    return { resumed: true as const };
  },
});
