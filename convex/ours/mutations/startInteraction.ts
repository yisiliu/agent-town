import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { getPlugin } from '../interactions/gameRegistry';
import '../interactions/werewolf'; // self-register

// Starts a new interaction. v1 is internalMutation — called from the
// smoke test and from `bunx convex run` by the operator. An authed
// public wrapper for the instructor UI lands later.
export default internalMutation({
  args: {
    type: v.string(),
    participants: v.array(v.id('twins')),
    seed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const plugin = getPlugin(args.type);
    if (!plugin) throw new Error(`unknown interaction type: ${args.type}`);
    if (args.participants.length < plugin.minPlayers) {
      throw new Error(
        `${args.type} needs ≥${plugin.minPlayers} players, got ${args.participants.length}`,
      );
    }
    if (args.participants.length > plugin.maxPlayers) {
      throw new Error(
        `${args.type} max ${plugin.maxPlayers} players, got ${args.participants.length}`,
      );
    }
    const seed = args.seed ?? Math.floor(Math.random() * 2 ** 31);
    const state = plugin.initialState(args.participants, seed) as { phase: string };
    const now = Date.now();
    return await ctx.db.insert('interactions', {
      type: args.type,
      status: 'in_progress' as const,
      participants: args.participants,
      state,
      turnIndex: 0,
      phase: state.phase,
      lastTickAt: 0,
      seed,
      startedAt: now,
    });
  },
});
