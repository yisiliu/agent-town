import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';

// Upsert a row in llmCacheStats keyed by (todayUtc, callType). Called
// after every DeepSeek API response that carries prompt_cache_hit /
// prompt_cache_miss usage fields. One row per (date, callType) per
// day means at most ~10 rows/day of write churn even at high LLM
// call volume.

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export default internalMutation({
  args: {
    callType: v.string(),
    hitTokens: v.number(),
    missTokens: v.number(),
    outputTokens: v.number(),
  },
  handler: async (ctx, args) => {
    const date = todayUtc();
    const existing = await ctx.db
      .query('llmCacheStats')
      .withIndex('dateCall', (q) => q.eq('dateUtc', date).eq('callType', args.callType))
      .first();
    const now = Date.now();
    if (!existing) {
      await ctx.db.insert('llmCacheStats', {
        dateUtc: date,
        callType: args.callType,
        callCount: 1,
        hitTokens: args.hitTokens,
        missTokens: args.missTokens,
        outputTokens: args.outputTokens,
        lastUpdated: now,
      });
      return;
    }
    await ctx.db.patch(existing._id, {
      callCount: existing.callCount + 1,
      hitTokens: existing.hitTokens + args.hitTokens,
      missTokens: existing.missTokens + args.missTokens,
      outputTokens: existing.outputTokens + args.outputTokens,
      lastUpdated: now,
    });
  },
});
