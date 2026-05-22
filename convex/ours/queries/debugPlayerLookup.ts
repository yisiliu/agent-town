import { v } from 'convex/values';
import { query } from '../../_generated/server';

// Diagnostic: list playerDescriptions for a given pseudonym so we can
// see how many players in the default world share a name.
export default query({
  args: { pseudonym: v.string() },
  handler: async (ctx, { pseudonym }) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return { worldId: null, players: [] };
    const all = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', status.worldId))
      .collect();
    const matches = all.filter((p) => p.name === pseudonym);
    return {
      worldId: status.worldId,
      totalDescriptions: all.length,
      matches: matches.map((p) => ({ playerId: p.playerId, name: p.name })),
    };
  },
});
