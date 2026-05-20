import { v } from 'convex/values';
import { query } from '../../_generated/server';

// Public spectator query: returns the interaction's lightweight metadata
// plus all its turns (since v1 the instructor / class can see everything,
// including private thinking — that's pedagogically valuable). For real
// audience-facing UIs we'd filter by visibility.
export default query({
  args: { id: v.id('interactions') },
  handler: async (ctx, args) => {
    const inter = await ctx.db.get(args.id);
    if (!inter) return null;

    const turns = await ctx.db
      .query('interactionTurns')
      .withIndex('by_interaction_and_turnIndex', (q) =>
        q.eq('interactionId', args.id),
      )
      .order('asc')
      .take(500);

    // Build a participant → pseudonym map by looking up each twin.
    const nameMap: Record<string, string> = {};
    for (const twinId of inter.participants) {
      const twin = await ctx.db.get(twinId);
      if (twin) nameMap[twinId as unknown as string] = twin.pseudonym;
    }

    return {
      interaction: {
        _id: inter._id,
        type: inter.type,
        status: inter.status,
        phase: inter.phase,
        turnIndex: inter.turnIndex,
        startedAt: inter.startedAt,
        endedAt: inter.endedAt,
        winner: inter.winner,
        originType: inter.originType ?? 'standalone',
        worldId: inter.worldId,
        publicLog: (inter.state as { publicLog?: string[] })?.publicLog ?? [],
        day: (inter.state as { day?: number })?.day,
        sheriff: (inter.state as { sheriff?: string })?.sheriff,
      },
      nameMap,
      turns: turns.map((t) => ({
        _id: t._id,
        turnIndex: t.turnIndex,
        phase: t.phase,
        kind: t.kind,
        actorTwinId: t.actorTwinId,
        text: t.text,
        data: t.data,
        visibility: t.visibility,
        timestamp: t.timestamp,
      })),
    };
  },
});
