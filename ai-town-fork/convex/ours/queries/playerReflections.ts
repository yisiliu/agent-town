import { v } from 'convex/values';
import { query } from '../../_generated/server';
import { playerId } from '../../aiTown/ids';

// Recent reflection memories for a player. Reflections are LLM-
// generated self-summaries the agent writes about its own life
// (see convex/agent/memory.ts:reflectOnMemories). Showing them in
// the PlayerDetails sidebar gives students a window into the agent's
// internal model of itself — useful for teaching "what is an LLM
// agent actually keeping track of".
//
// Walks the `playerId_type` index filtered to type=reflection,
// newest first, and caps at the requested limit (default 5).
export default query({
  args: {
    playerId,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 5;
    const rows = await ctx.db
      .query('memories')
      .withIndex('playerId_type', (q) =>
        q.eq('playerId', args.playerId).eq('data.type', 'reflection'),
      )
      .order('desc')
      .take(limit);
    return rows.map((r) => ({
      _id: r._id,
      createdAt: r._creationTime,
      description: r.description,
      importance: r.importance,
    }));
  },
});
