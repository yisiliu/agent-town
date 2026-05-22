import { action, internalQuery } from '../../_generated/server';
import { internal, api } from '../../_generated/api';

// One-shot: re-promote every active student twin so the in-world
// agent + description matches the LATEST card content. Useful after
// a dedup pass where older twins were suspended but the in-world
// player still reflects the older card.
//
// Skips synth-* NPCs (left alone). For each pseudonym, picks the
// newest active twin and calls the (now-replace-aware) promote
// mutation. The new promote mutation: leaves old same-name players,
// suspends older same-name twins, then queues createAgentInline.
//
// Safe to re-run.

interface ActiveTwin {
  _id: string;
  pseudonym: string;
  createdAt: number;
  isNpc: boolean;
}

export const collectActiveTwinsForRefresh = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('twins')
      .withIndex('state', (q) => q.eq('state', 'active'))
      .collect();
    return rows.map((r) => ({
      _id: r._id as unknown as string,
      pseudonym: r.pseudonym,
      createdAt: r.createdAt,
      isNpc: r.studentRealNameHash.startsWith('synth-'),
    }));
  },
});

/* eslint-disable @typescript-eslint/no-explicit-any */
export default action({
  args: {},
  handler: async (ctx): Promise<{
    refreshed: { pseudonym: string; leftPlayers: number; suspendedOlder: number }[];
    skipped: { pseudonym: string; reason: string }[];
  }> => {
    const twins = (await ctx.runQuery(
      internal.ours.actions.refreshAllInWorld.collectActiveTwinsForRefresh as any,
      {},
    )) as ActiveTwin[];

    // Group by pseudonym, keep newest per group.
    const byName = new Map<string, ActiveTwin>();
    for (const t of twins) {
      if (t.isNpc) continue;
      const prev = byName.get(t.pseudonym);
      if (!prev || t.createdAt > prev.createdAt) byName.set(t.pseudonym, t);
    }

    const refreshed: { pseudonym: string; leftPlayers: number; suspendedOlder: number }[] = [];
    const skipped: { pseudonym: string; reason: string }[] = [];
    for (const [pseudonym, t] of byName) {
      try {
        const res = (await ctx.runMutation(
          api.ours.mutations.promoteTwinToAgent.default as any,
          { twinId: t._id as any },
        )) as { leftPlayers?: number; suspendedOlder?: number };
        refreshed.push({
          pseudonym,
          leftPlayers: res?.leftPlayers ?? 0,
          suspendedOlder: res?.suspendedOlder ?? 0,
        });
      } catch (e) {
        skipped.push({ pseudonym, reason: (e as Error).message.slice(0, 120) });
      }
    }

    return { refreshed, skipped };
  },
});
