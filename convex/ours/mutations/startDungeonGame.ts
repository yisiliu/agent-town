import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { getPlugin } from '../interactions/gameRegistry';
import '../interactions/werewolf'; // self-register

// =============================================================================
// startDungeonGame — public bridge entry point from ai-town to the
// Interactions framework. The "dungeon" metaphor: a location in the ai-town
// world where N agents can be plugged into a board game (werewolf today,
// future plugins tomorrow). For each ai-town playerId:
//   1. find or create a twin row representing that agent (idempotent)
//   2. collect the twin IDs
// Then start an interaction with those twins + originType='dungeon' +
// worldId + originPlayerIds so memory write-back can route results back
// to ai-town when the game ends.
// =============================================================================
export default mutation({
  args: {
    worldId: v.id('worlds'),
    type: v.string(),
    playerIds: v.array(v.string()),
    seed: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ interactionId: Id<'interactions'>; participants: Id<'twins'>[] }> => {
    const plugin = getPlugin(args.type);
    if (!plugin) throw new Error(`unknown dungeon type: ${args.type}`);
    if (args.playerIds.length < plugin.minPlayers) {
      throw new Error(
        `${args.type} dungeon needs ≥${plugin.minPlayers} agents, got ${args.playerIds.length}`,
      );
    }
    if (args.playerIds.length > plugin.maxPlayers) {
      throw new Error(
        `${args.type} dungeon max ${plugin.maxPlayers} agents, got ${args.playerIds.length}`,
      );
    }

    // 0. Double-borrow guard: refuse to start if any requested player is
    //    already committed to another live dungeon game (gathering or
    //    in_progress). There's no originType index, so scan the two live
    //    statuses via by_status_and_lastTickAt, filter to dungeon-origin, and
    //    check originPlayerIds ∪ pendingPlayerIds for overlap. (participants are
    //    twin IDs, not ai-town playerIds — don't check those.)
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ref = internal as any;
    const live = [
      ...(await ctx.db
        .query('interactions')
        .withIndex('by_status_and_lastTickAt', (q) => q.eq('status', 'gathering'))
        .take(50)),
      ...(await ctx.db
        .query('interactions')
        .withIndex('by_status_and_lastTickAt', (q) => q.eq('status', 'in_progress'))
        .take(50)),
    ];
    const requested = new Set(args.playerIds);
    for (const other of live) {
      if (other.originType !== 'dungeon') continue;
      const claimed = [
        ...(other.originPlayerIds ?? []),
        ...(other.pendingPlayerIds ?? []),
      ];
      const clash = claimed.find((pid) => requested.has(pid));
      if (clash !== undefined) {
        throw new Error(
          `player ${clash} is already in another dungeon game (${other._id})`,
        );
      }
    }

    // 1. Find or create a twin for each ai-town player. Sequential so
    //    failures surface clearly (rare in normal use; one-shot operation).
    const twinIds: Id<'twins'>[] = [];
    for (const playerId of args.playerIds) {
      const { twinId } = (await ctx.runMutation(
        ref.ours.mutations.findOrCreateTwinForAgent.default,
        { worldId: args.worldId, playerId },
      )) as { twinId: Id<'twins'>; created: boolean };
      twinIds.push(twinId);
    }

    // 2. Run the plugin's initialState and insert the interaction row in the
    //    'gathering' phase. We mirror startInteraction's insert here rather
    //    than calling it through ctx.runMutation — that way the dungeon-origin
    //    fields are part of the same transaction as twin creation. The hide +
    //    return-state snapshot now happens lazily in gatherStep as each agent
    //    becomes conversation-free.
    const seed = args.seed ?? Math.floor(Math.random() * 2 ** 31);
    const state = plugin.initialState(twinIds, seed) as { phase: string };
    const now = Date.now();
    const interactionId = await ctx.db.insert('interactions', {
      type: args.type,
      status: 'gathering' as const,
      participants: twinIds,
      state,
      turnIndex: 0,
      phase: state.phase,
      lastTickAt: 0,
      seed,
      startedAt: now,
      originType: 'dungeon' as const,
      worldId: args.worldId,
      originPlayerIds: args.playerIds,
      pendingPlayerIds: args.playerIds,
      gatheringStartedAt: now,
    });

    // 3. Kick the gather chain: gatherStep pulls each pending player in once
    //    they're conversation-free, then flips the game to 'in_progress'.
    await ctx.scheduler.runAfter(0, ref.ours.mutations.gatherStep.default, {
      interactionId,
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */

    return { interactionId, participants: twinIds };
  },
});
