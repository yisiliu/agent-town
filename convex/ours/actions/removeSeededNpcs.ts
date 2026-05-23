import { action, internalMutation, internalQuery } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { v } from 'convex/values';
import { insertInput } from '../../aiTown/insertInput';
import { NPC_CARDS } from '../data/npcCards';
import type { Id } from '../../_generated/dataModel';

// Match-by-pseudonym removal of the AI-synthesised NPCs seeded by
// seedNpcCards. We can't rely on the synth- prefix on studentRealNameHash
// because seedNpcCards historically used the sentinel `_npc_seed`, and
// the rows might have been re-uploaded or had their hash overwritten
// since. Pseudonym match against the static `NPC_CARDS` data module is
// the most reliable signal.

interface NpcRow {
  twinId: string;
  pseudonym: string;
  cardId: string | null;
  playerIds: string[];
}

export const findActiveNpcs = internalQuery({
  args: {},
  handler: async (ctx) => {
    const seedPseudonyms = new Set(NPC_CARDS.map((c: { pseudonym: string }) => c.pseudonym));
    const twins = await ctx.db
      .query('twins')
      .withIndex('state', (q) => q.eq('state', 'active'))
      .collect();
    const matched = twins.filter((t) => seedPseudonyms.has(t.pseudonym));

    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return { worldId: null, npcs: [] as NpcRow[] };

    // Cross-reference with live playerDescriptions to find playerIds.
    const out: NpcRow[] = [];
    for (const t of matched) {
      const descs = await ctx.db
        .query('playerDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', status.worldId))
        .filter((q) => q.eq(q.field('name'), t.pseudonym))
        .collect();
      out.push({
        twinId: t._id as unknown as string,
        pseudonym: t.pseudonym,
        cardId: (t.cardId as unknown as string | undefined) ?? null,
        playerIds: descs.map((d) => d.playerId as unknown as string),
      });
    }
    return { worldId: status.worldId as unknown as string, npcs: out };
  },
});

export const suspendAndDelete = internalMutation({
  args: { twinId: v.id('twins') },
  handler: async (ctx, { twinId }) => {
    const t = await ctx.db.get(twinId);
    if (!t) return { deleted: false };
    if (t.cardId) {
      try { await ctx.db.delete(t.cardId); } catch { /* card gone */ }
    }
    await ctx.db.delete(twinId);
    return { deleted: true };
  },
});

export const leavePlayer = internalMutation({
  args: { worldId: v.id('worlds'), playerId: v.string() },
  handler: async (ctx, args) => {
    return await insertInput(ctx, args.worldId, 'leave', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      playerId: args.playerId as any,
    });
  },
});

/* eslint-disable @typescript-eslint/no-explicit-any */
export default action({
  args: {},
  handler: async (ctx): Promise<{
    npcsFound: number;
    leavesIssued: number;
    twinsDeleted: number;
    pseudonyms: string[];
  }> => {
    const { worldId, npcs } = (await ctx.runQuery(
      internal.ours.actions.removeSeededNpcs.findActiveNpcs as any,
      {},
    )) as { worldId: string | null; npcs: NpcRow[] };

    if (npcs.length === 0) return { npcsFound: 0, leavesIssued: 0, twinsDeleted: 0, pseudonyms: [] };

    let leavesIssued = 0;
    if (worldId) {
      for (const n of npcs) {
        for (const pid of n.playerIds) {
          try {
            await ctx.runMutation(
              internal.ours.actions.removeSeededNpcs.leavePlayer as any,
              { worldId: worldId as unknown as Id<'worlds'>, playerId: pid },
            );
            leavesIssued++;
          } catch { /* already gone */ }
        }
      }
    }

    let twinsDeleted = 0;
    for (const n of npcs) {
      const res = await ctx.runMutation(
        internal.ours.actions.removeSeededNpcs.suspendAndDelete as any,
        { twinId: n.twinId as any },
      );
      if (res?.deleted) twinsDeleted++;
    }

    return {
      npcsFound: npcs.length,
      leavesIssued,
      twinsDeleted,
      pseudonyms: npcs.map((n) => n.pseudonym),
    };
  },
});
