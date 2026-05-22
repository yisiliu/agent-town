import { action, internalQuery } from '../../_generated/server';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';

// Dedup the live world. For every name that appears more than once in
// playerDescriptions, keep the newest player (by _creationTime) and
// issue 'leave' inputs for the older ones. Also drops players whose
// pseudonym matches a section-header (the auto-heal had a bug).

const BAD_PSEUDONYMS = new Set([
  '背景', '简介', '介绍', '自我介绍', '性格', '说话方式',
  '数字分身档案', '人物背景', '基本信息',
]);

interface PD {
  _id: string;
  _creationTime: number;
  playerId: string;
  name: string;
}

export const collectPlayers = internalQuery({
  args: {},
  handler: async (ctx) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return { worldId: null, players: [] as PD[] };
    const rows = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', status.worldId))
      .collect();
    return {
      worldId: status.worldId as unknown as string,
      players: rows.map((r) => ({
        _id: r._id as unknown as string,
        _creationTime: r._creationTime,
        playerId: r.playerId as unknown as string,
        name: r.name,
      })),
    };
  },
});

/* eslint-disable @typescript-eslint/no-explicit-any */
export default action({
  args: {},
  handler: async (ctx): Promise<{ left: { name: string; playerId: string; reason: string }[]; kept: string[] }> => {
    const { worldId, players } = (await ctx.runQuery(
      internal.ours.actions.dedupWorldPlayers.collectPlayers as any,
      {},
    )) as { worldId: string | null; players: PD[] };

    if (!worldId) return { left: [], kept: [] };

    // Group by name.
    const byName = new Map<string, PD[]>();
    for (const p of players) {
      const arr = byName.get(p.name) ?? [];
      arr.push(p);
      byName.set(p.name, arr);
    }

    const toLeave: { name: string; playerId: string; reason: string }[] = [];
    const kept: string[] = [];

    for (const [name, arr] of byName) {
      if (BAD_PSEUDONYMS.has(name)) {
        for (const p of arr) {
          toLeave.push({ name, playerId: p.playerId, reason: 'bad pseudonym (section header)' });
        }
        continue;
      }
      if (arr.length === 1) {
        kept.push(`${name} (only one)`);
        continue;
      }
      // Sort newest first; keep arr[0], leave the rest.
      arr.sort((a, b) => b._creationTime - a._creationTime);
      kept.push(`${name} (kept newest of ${arr.length})`);
      for (let i = 1; i < arr.length; i++) {
        toLeave.push({ name, playerId: arr[i]!.playerId, reason: 'duplicate (older)' });
      }
    }

    // Issue leave inputs.
    for (const t of toLeave) {
      try {
        await ctx.runMutation(
          internal.ours.actions.dedupActiveTwins.leavePlayer as any,
          { worldId: worldId as unknown as Id<'worlds'>, playerId: t.playerId },
        );
      } catch (e) {
        t.reason += ` (leave failed: ${(e as Error).message.slice(0, 80)})`;
      }
    }

    return { left: toLeave, kept };
  },
});
