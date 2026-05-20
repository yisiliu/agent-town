import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { getPlugin } from '../interactions/gameRegistry';
import '../interactions/werewolf'; // self-register

// Appends a turn to an interaction. Re-loads the interaction's current
// state, runs plugin.applyTurn → plugin.checkWin, and patches the
// interactions row with the new state + turnIndex + phase. On win,
// status flips to 'ended' and `winner` is recorded.
//
// `expectedTurnIndex` is the optimistic-concurrency backstop against
// the cron racing two takeTurn actions. The cron's `inflightSince`
// dedup keeps the race rare; this check keeps it correct.
export default internalMutation({
  args: {
    interactionId: v.id('interactions'),
    expectedTurnIndex: v.number(),
    phase: v.string(),
    kind: v.string(),
    actorTwinId: v.optional(v.id('twins')),
    text: v.string(),
    data: v.optional(v.any()),
    visibility: v.union(v.literal('public'), v.array(v.id('twins'))),
  },
  handler: async (ctx, args) => {
    const inter = await ctx.db.get(args.interactionId);
    if (!inter) throw new Error('interaction not found');
    if (inter.status !== 'in_progress') {
      return { applied: false as const, reason: 'not_in_progress' as const };
    }
    if (inter.turnIndex !== args.expectedTurnIndex) {
      return { applied: false as const, reason: 'stale_turnIndex' as const };
    }
    const plugin = getPlugin(inter.type);
    if (!plugin) throw new Error(`no plugin for type ${inter.type}`);
    const now = Date.now();

    await ctx.db.insert('interactionTurns', {
      interactionId: args.interactionId,
      turnIndex: inter.turnIndex,
      phase: args.phase,
      actorTwinId: args.actorTwinId,
      kind: args.kind,
      text: args.text,
      data: args.data,
      visibility: args.visibility,
      timestamp: now,
    });

    const nextState = plugin.applyTurn(inter.state, {
      phase: args.phase,
      kind: args.kind,
      actorTwinId: args.actorTwinId ?? null,
      text: args.text,
      data: args.data,
    }) as { phase: string };
    const win = plugin.checkWin(nextState);

    if (win.ended) {
      const endedState = { ...nextState, phase: 'ended', winner: win.winner };
      await ctx.db.patch(args.interactionId, {
        state: endedState,
        turnIndex: inter.turnIndex + 1,
        phase: 'ended',
        status: 'ended',
        endedAt: now,
        winner: win.winner,
        lastTickAt: now,
        inflightSince: undefined,
      });
      // Write per-participant interactionMemories so what each agent
      // "remembers" of this game is durable. Dungeon-origin games
      // additionally carry the originPlayerId for future ai-town write-back.
      const originPlayerIds = inter.originPlayerIds ?? [];
      for (let i = 0; i < inter.participants.length; i++) {
        const twinId = inter.participants[i]!;
        const { outcome, summary } = plugin.summarizeFor(endedState, twinId);
        await ctx.db.insert('interactionMemories', {
          interactionId: args.interactionId,
          twinId,
          originPlayerId: originPlayerIds[i],
          outcome,
          summary,
          createdAt: now,
        });
      }
    } else {
      await ctx.db.patch(args.interactionId, {
        state: nextState,
        turnIndex: inter.turnIndex + 1,
        phase: nextState.phase,
        lastTickAt: now,
        inflightSince: undefined,
      });
    }
    return { applied: true as const, ended: win.ended };
  },
});
