import { internalAction, internalQuery } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { fetchDeepseekBalance } from '../lib/deepseekClient';

// One-off audit: aggregate LLM usage by tier + callType from the
// idempotency cache, sum frontier spend from agentDailySpend, hit
// DeepSeek's /user/balance for current remaining balance. Run via
// `bunx convex run --prod ours/actions/auditLlmSpend:default`.
//
// Caveats:
//   - llmCallIdempotency only retains cached responses (TTL-bounded),
//     so the call-count breakdown is "what's active in cache", not
//     lifetime total.
//   - agentDailySpend only records frontier (pro) cost — local
//     (flash) cost is computed per-call but not persisted.

export const aggregate = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    // 1. agentDailySpend (last 7 days, frontier only)
    const spendRows = await ctx.db.query('agentDailySpend').collect();
    const recentSpend = spendRows.filter((r) => r.lastUpdated >= sevenDaysAgo);
    const totalFrontierUsd = recentSpend.reduce((sum, r) => sum + r.costUsd, 0);
    const byDay: Record<string, number> = {};
    for (const r of recentSpend) byDay[r.dateUtc] = (byDay[r.dateUtc] ?? 0) + r.costUsd;

    // 2. llmCallIdempotency: count + last-seen by (tier, callType)
    const idempRows = await ctx.db.query('llmCallIdempotency').collect();
    const byTierCalltype: Record<string, { tier: string; callType: string; count: number; mostRecentAt: number }> = {};
    for (const r of idempRows) {
      const key = `${r.tier}::${r.callType}`;
      const cur = byTierCalltype[key];
      if (!cur) {
        byTierCalltype[key] = {
          tier: r.tier,
          callType: r.callType,
          count: 1,
          mostRecentAt: r.cachedAt,
        };
      } else {
        cur.count++;
        if (r.cachedAt > cur.mostRecentAt) cur.mostRecentAt = r.cachedAt;
      }
    }
    const callBreakdown = Object.values(byTierCalltype).sort((a, b) => b.count - a.count);
    const totalCalls = idempRows.length;
    const frontierCalls = idempRows.filter((r) => r.tier === 'frontier').length;
    const localCalls = idempRows.filter((r) => r.tier === 'local').length;

    return {
      windowDays: 7,
      spendUsd: {
        totalFrontier: totalFrontierUsd,
        byDay,
        note: 'frontier (pro) only — local (flash) spend not persisted',
      },
      callsInCache: {
        total: totalCalls,
        frontier: frontierCalls,
        local: localCalls,
        frontierPct: totalCalls === 0 ? 0 : Math.round((frontierCalls / totalCalls) * 100),
        breakdown: callBreakdown,
        note: 'idempotency cache is TTL-bounded; this is "active in cache" not lifetime',
      },
    };
  },
});

/* eslint-disable @typescript-eslint/no-explicit-any */
export default internalAction({
  args: {},
  handler: async (ctx): Promise<any> => {
    const internal_aggregate = (await ctx.runQuery(
      internal.ours.actions.auditLlmSpend.aggregate as any,
      {},
    )) as any;

    let balance: any = null;
    let balanceError: string | null = null;
    try {
      balance = await fetchDeepseekBalance();
    } catch (e) {
      balanceError = (e as Error).message;
    }

    return {
      ...internal_aggregate,
      deepseekBalance: balance,
      deepseekBalanceError: balanceError,
    };
  },
});
