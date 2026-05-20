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

    // 1. Find or create a twin for each ai-town player. Sequential so
    //    failures surface clearly (rare in normal use; one-shot operation).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ref = internal as any;
    const twinIds: Id<'twins'>[] = [];
    for (const playerId of args.playerIds) {
      const { twinId } = (await ctx.runMutation(
        ref.ours.mutations.findOrCreateTwinForAgent.default,
        { worldId: args.worldId, playerId },
      )) as { twinId: Id<'twins'>; created: boolean };
      twinIds.push(twinId);
    }

    // 2. Run the plugin's initialState and insert the interaction row.
    //    We mirror startInteraction's insert here rather than calling it
    //    through ctx.runMutation — that way the dungeon-origin fields are
    //    part of the same transaction as twin creation + teleport.
    const seed = args.seed ?? Math.floor(Math.random() * 2 ** 31);
    const state = plugin.initialState(twinIds, seed) as { phase: string };
    const now = Date.now();
    const interactionId = await ctx.db.insert('interactions', {
      type: args.type,
      status: 'in_progress' as const,
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
    });

    // 3. Teleport each player off-screen + save their return state.
    //    We move them to HIDDEN_COORD (well outside any reasonable map)
    //    so the frontend renderer effectively can't show them, and we
    //    clear pathfinding + activity so ai-town's engine has nothing to
    //    tick for them. They remain in world.players[] so the bridge
    //    knows where to put them back when the game ends.
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`startDungeonGame: world ${args.worldId} not found`);
    }
    const players = world.players.map((p) => ({ ...p }));
    for (const pid of args.playerIds) {
      const idx = players.findIndex((p) => p.id === pid);
      if (idx === -1) {
        throw new Error(
          `startDungeonGame: player ${pid} not in world.players[]`,
        );
      }
      const player = players[idx]!;
      await ctx.db.insert('dungeonReturnState', {
        interactionId,
        worldId: args.worldId,
        playerId: pid,
        savedPosition: { x: player.position.x, y: player.position.y },
        savedFacing: { dx: player.facing.dx, dy: player.facing.dy },
        enteredAt: now,
      });
      // Hidden coord — outside any reasonable map; the renderer's
      // viewport never sees it.
      players[idx] = {
        ...player,
        position: { x: -9999, y: -9999 },
        pathfinding: undefined,
        activity: undefined,
        speed: 0,
      };
    }
    await ctx.db.patch(args.worldId, { players });
    /* eslint-enable @typescript-eslint/no-explicit-any */

    return { interactionId, participants: twinIds };
  },
});
