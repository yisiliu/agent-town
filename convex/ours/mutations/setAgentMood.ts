import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { moodValues } from '../tables/agentMoods';

// Set (or update) the mood for a single agent. Called by:
// - Mood-detection logic after conversation messages
// - Mood-decay cron to drift toward neutral
// - Instructor control panel (optional)
//
// Idempotent: if a mood row already exists for this agent, it's updated
// in-place; otherwise a new row is inserted.
export default mutation({
  args: {
    agentId: v.string(),
    worldId: v.id('worlds'),
    mood: v.union(
      v.literal('happy'),
      v.literal('neutral'),
      v.literal('sad'),
      v.literal('angry'),
      v.literal('excited'),
      v.literal('anxious'),
      v.literal('bored'),
      v.literal('confused'),
      v.literal('flirty'),
      v.literal('mischievous'),
      v.literal('jealous'),
      v.literal('proud'),
      v.literal('hopeful'),
      v.literal('lonely'),
      v.literal('surprised'),
      v.literal('grateful'),
    ),
    moodReason: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('agentMoods')
      .withIndex('by_agent', (q) => q.eq('agentId', args.agentId))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        mood: args.mood,
        moodReason: args.moodReason,
        updatedAt: now,
      });
      return { ok: true, created: false, previousMood: existing.mood };
    }
    await ctx.db.insert('agentMoods', {
      agentId: args.agentId,
      worldId: args.worldId,
      mood: args.mood,
      moodReason: args.moodReason,
      updatedAt: now,
    });
    return { ok: true, created: true, previousMood: null };
  },
});
