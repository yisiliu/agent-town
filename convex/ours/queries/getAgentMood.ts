import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';

// Internal query — called from conversation actions to fetch mood
// before building the system prompt.
export default internalQuery({
  args: {
    agentId: v.string(),
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const mood = await ctx.db
      .query('agentMoods')
      .withIndex('by_agent', (q) => q.eq('agentId', args.agentId))
      .first();
    if (!mood) return null;
    return {
      mood: mood.mood,
      moodReason: mood.moodReason,
      updatedAt: mood.updatedAt,
    };
  },
});
