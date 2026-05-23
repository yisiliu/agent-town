import { v } from 'convex/values';
import { query } from '../../_generated/server';

// Public query — returns mood for every agent in the given world.
// The 2D frontend uses this to display mood emoji above agent heads.
export default query({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const moods = await ctx.db
      .query('agentMoods')
      .withIndex('by_world', (q) => q.eq('worldId', args.worldId))
      .collect();
    // Return as Record<agentId, {mood, moodReason}> for O(1) lookup.
    const byAgent: Record<string, { mood: string; moodReason: string }> = {};
    for (const m of moods) {
      byAgent[m.agentId] = { mood: m.mood, moodReason: m.moodReason };
    }
    return byAgent;
  },
});
