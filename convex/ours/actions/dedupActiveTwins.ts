import { action, internalMutation, internalQuery } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { v } from 'convex/values';
import { insertInput } from '../../aiTown/insertInput';
import type { Id } from '../../_generated/dataModel';

// One-shot dedup: for each pseudonym with >1 active twin, suspend all
// but the newest. Also unconditionally suspends any twin whose
// pseudonym matches a common section header (e.g. "背景") because that
// signals the auto-heal in uploadTwin grabbed the wrong H1.
//
// For each suspended twin we ALSO issue a 'leave' input on the engine
// so the player vanishes from the map; otherwise the sprite stays and
// keeps initiating conversations.

const BAD_PSEUDONYMS = new Set([
  '背景', '简介', '介绍', '自我介绍', '性格', '说话方式', '在乎', '在乎的事',
]);

interface TwinRecord {
  _id: string;
  pseudonym: string;
  createdAt: number;
}

interface PlayerLookup {
  twinId: string;
  pseudonym: string;
  playerId: string | null;
}

export const findActiveTwins = internalQuery({
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
    }));
  },
});

// Decide which twins to suspend. Pure JS so it stays unit-testable.
function decideToSuspend(twins: TwinRecord[]): { twinId: string; pseudonym: string; reason: string }[] {
  const byPseudonym = new Map<string, TwinRecord[]>();
  for (const t of twins) {
    const arr = byPseudonym.get(t.pseudonym) ?? [];
    arr.push(t);
    byPseudonym.set(t.pseudonym, arr);
  }
  const out: { twinId: string; pseudonym: string; reason: string }[] = [];
  for (const [pseudonym, arr] of byPseudonym) {
    const isBad = BAD_PSEUDONYMS.has(pseudonym);
    if (isBad) {
      for (const t of arr) {
        out.push({ twinId: t._id, pseudonym, reason: 'pseudonym matches section header' });
      }
      continue;
    }
    if (arr.length <= 1) continue;
    // Sort newest first; keep [0], suspend the rest.
    arr.sort((a, b) => b.createdAt - a.createdAt);
    for (let i = 1; i < arr.length; i++) {
      out.push({ twinId: arr[i]!._id, pseudonym, reason: 'duplicate (older)' });
    }
  }
  return out;
}

export const lookupPlayerIds = internalQuery({
  args: { pseudonyms: v.array(v.string()) },
  handler: async (ctx, { pseudonyms }) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return { worldId: null, players: [] as PlayerLookup[] };
    const out: PlayerLookup[] = [];
    for (const ps of pseudonyms) {
      const pd = await ctx.db
        .query('playerDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', status.worldId))
        .filter((q) => q.eq(q.field('name'), ps))
        .collect();
      // If multiple players share the name (which is the symptom we're
      // fixing), surface all of them so the action can leave each one.
      for (const p of pd) {
        out.push({ twinId: '', pseudonym: ps, playerId: p.playerId as unknown as string });
      }
    }
    return { worldId: status.worldId as unknown as string, players: out };
  },
});

// Queue a 'leave' engine input for a single player. Wraps insertInput so
// the action can issue it via ctx.runMutation (insertInput is a helper,
// not a mutation, so it can't be called from an action directly).
export const leavePlayer = internalMutation({
  args: { worldId: v.id('worlds'), playerId: v.string() },
  handler: async (ctx, args) => {
    return await insertInput(ctx, args.worldId, 'leave', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      playerId: args.playerId as any,
    });
  },
});

export const suspendTwinsChunk = internalMutation({
  args: { twinIds: v.array(v.id('twins')) },
  handler: async (ctx, { twinIds }) => {
    let n = 0;
    for (const id of twinIds) {
      await ctx.db.patch(id, { state: 'suspended' });
      n++;
    }
    return { suspended: n };
  },
});

/* eslint-disable @typescript-eslint/no-explicit-any */
export default action({
  args: {},
  handler: async (ctx): Promise<{
    suspended: { twinId: string; pseudonym: string; reason: string }[];
    leftPlayers: number;
  }> => {
    const twins = (await ctx.runQuery(
      internal.ours.actions.dedupActiveTwins.findActiveTwins as any,
      {},
    )) as TwinRecord[];

    const toSuspend = decideToSuspend(twins);
    if (toSuspend.length === 0) {
      return { suspended: [], leftPlayers: 0 };
    }

    // Look up player IDs for all pseudonyms we're suspending — names
    // can repeat in the world (the symptom we're fixing), so we leave
    // ALL matching players. Real students stay active in their own
    // (newest) twin and get a fresh promotion if anyone re-uploads.
    const uniquePseudonyms = Array.from(new Set(toSuspend.map((t) => t.pseudonym)));
    const lookup = (await ctx.runQuery(
      internal.ours.actions.dedupActiveTwins.lookupPlayerIds as any,
      { pseudonyms: uniquePseudonyms },
    )) as { worldId: string | null; players: PlayerLookup[] };

    // Issue leave inputs.
    let leftPlayers = 0;
    if (lookup.worldId) {
      for (const p of lookup.players) {
        if (!p.playerId) continue;
        try {
          await ctx.runMutation(
            internal.ours.actions.dedupActiveTwins.leavePlayer as any,
            { worldId: lookup.worldId as unknown as Id<'worlds'>, playerId: p.playerId },
          );
          leftPlayers++;
        } catch {
          // Player already gone, etc. — keep going.
        }
      }
    }

    // Suspend the twins.
    await ctx.runMutation(
      internal.ours.actions.dedupActiveTwins.suspendTwinsChunk as any,
      { twinIds: toSuspend.map((t) => t.twinId) },
    );

    return { suspended: toSuspend, leftPlayers };
  },
});
