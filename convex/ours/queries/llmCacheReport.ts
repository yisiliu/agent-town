import { query } from '../../_generated/server';

// Per-day cache hit summary, today + recent. Pulls llmCacheStats
// rows (one per (date, callType)) and computes hit rate + estimated
// $ saved by cache hits at flash promo prices.
export default query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('llmCacheStats').collect();
    rows.sort((a, b) =>
      a.dateUtc === b.dateUtc ? a.callType.localeCompare(b.callType) : a.dateUtc.localeCompare(b.dateUtc),
    );
    return rows.map((r) => {
      const totalIn = r.hitTokens + r.missTokens;
      const hitPct = totalIn > 0 ? Math.round((r.hitTokens / totalIn) * 1000) / 10 : 0;
      // Flash promo pricing: $0.14/M input miss, $0.014/M cache hit, $0.28/M output
      const cost =
        r.missTokens * (0.14 / 1_000_000) +
        r.hitTokens * (0.014 / 1_000_000) +
        r.outputTokens * (0.28 / 1_000_000);
      // What this would have cost without any cache hits
      const noCacheBaseline =
        totalIn * (0.14 / 1_000_000) +
        r.outputTokens * (0.28 / 1_000_000);
      const saved = noCacheBaseline - cost;
      return {
        dateUtc: r.dateUtc,
        callType: r.callType,
        callCount: r.callCount,
        hitTokens: r.hitTokens,
        missTokens: r.missTokens,
        outputTokens: r.outputTokens,
        cacheHitPct: hitPct,
        costUsd: Math.round(cost * 1_000_000) / 1_000_000,
        savedUsd: Math.round(saved * 1_000_000) / 1_000_000,
      };
    });
  },
});
