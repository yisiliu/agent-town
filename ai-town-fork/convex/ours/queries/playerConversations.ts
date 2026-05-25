import { v } from 'convex/values';
import { query } from '../../_generated/server';
import { playerId } from '../../aiTown/ids';
import type { Doc } from '../../_generated/dataModel';

// All archived conversations a given player participated in, ordered
// newest first. Walks the `participatedTogether.playerHistory` index,
// joins archivedConversations, dedups (a player can have multiple
// edge rows for the same conversation if it had >2 participants),
// drops empty conversations (invites that never started).
//
// Returns the full archivedConversations Doc so the existing
// Messages component can render each entry without an extra fetch
// when expanded.
export default query({
  args: {
    worldId: v.id('worlds'),
    playerId,
  },
  handler: async (ctx, args): Promise<Doc<'archivedConversations'>[]> => {
    const memberships = await ctx.db
      .query('participatedTogether')
      .withIndex('playerHistory', (q) =>
        q.eq('worldId', args.worldId).eq('player1', args.playerId),
      )
      .order('desc')
      .collect();

    const out: Doc<'archivedConversations'>[] = [];
    const seen = new Set<string>();
    for (const m of memberships) {
      if (seen.has(m.conversationId)) continue;
      seen.add(m.conversationId);

      const conv = await ctx.db
        .query('archivedConversations')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('id', m.conversationId))
        .unique();
      if (!conv) continue;
      if (conv.numMessages <= 0) continue;
      out.push(conv);
    }
    return out;
  },
});
