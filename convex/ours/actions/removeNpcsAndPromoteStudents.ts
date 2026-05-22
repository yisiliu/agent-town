import { action, internalMutation, internalQuery } from '../../_generated/server';
import { internal, api } from '../../_generated/api';
import { v } from 'convex/values';
import { insertInput } from '../../aiTown/insertInput';
import type { Id } from '../../_generated/dataModel';

// 1. Remove every AI-synthesised NPC (twin.studentRealNameHash starts
//    with 'synth-' — both the seedNpcCards cast and any older
//    insertGeneratedTwins/findOrCreateTwinForAgent rows). Issues a
//    'leave' input for each twin's live player AND deletes the twin
//    row + card so they don't return after a re-promote pass.
//
// 2. For every active student twin (the rest), check whether they
//    already have a live player in the world. If not, call
//    promoteTwinToAgent so they enter the town.
//
// Safe to re-run.

interface ActiveTwin {
  _id: string;
  pseudonym: string;
  cardId?: string;
  isNpc: boolean;
}

export const collectActiveTwins = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('twins')
      .withIndex('state', (q) => q.eq('state', 'active'))
      .collect();
    return rows.map((r) => ({
      _id: r._id as unknown as string,
      pseudonym: r.pseudonym,
      cardId: r.cardId as unknown as string | undefined,
      isNpc: r.studentRealNameHash.startsWith('synth-'),
    }));
  },
});

export const listActivePlayerNames = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Convex serialization forbids non-ASCII field names, so we return
    // an array of {name, playerIds} entries instead of a Record keyed
    // by Chinese pseudonyms.
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return { worldId: null, entries: [] as { name: string; playerIds: string[] }[] };
    const rows = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', status.worldId))
      .collect();
    const map = new Map<string, string[]>();
    for (const p of rows) {
      const arr = map.get(p.name) ?? [];
      arr.push(p.playerId as unknown as string);
      map.set(p.name, arr);
    }
    return {
      worldId: status.worldId as unknown as string,
      entries: Array.from(map.entries()).map(([name, playerIds]) => ({ name, playerIds })),
    };
  },
});

export const deleteTwinAndCard = internalMutation({
  args: { twinId: v.id('twins') },
  handler: async (ctx, { twinId }) => {
    const t = await ctx.db.get(twinId);
    if (!t) return { deleted: false };
    if (t.cardId) {
      try { await ctx.db.delete(t.cardId); } catch { /* ignore */ }
    }
    await ctx.db.delete(twinId);
    return { deleted: true };
  },
});

export const leavePlayerById = internalMutation({
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
    npcsLeft: number;
    npcsDeleted: number;
    studentsPromoted: string[];
    studentsSkipped: string[];
  }> => {
    const twins = (await ctx.runQuery(
      internal.ours.actions.removeNpcsAndPromoteStudents.collectActiveTwins as any,
      {},
    )) as ActiveTwin[];

    const { worldId, entries } = (await ctx.runQuery(
      internal.ours.actions.removeNpcsAndPromoteStudents.listActivePlayerNames as any,
      {},
    )) as { worldId: string | null; entries: { name: string; playerIds: string[] }[] };
    const byName = new Map<string, string[]>();
    for (const e of entries) byName.set(e.name, e.playerIds);

    let npcsLeft = 0;
    let npcsDeleted = 0;
    for (const t of twins) {
      if (!t.isNpc) continue;
      // Leave any live players for this NPC.
      if (worldId) {
        const ids = byName.get(t.pseudonym) ?? [];
        for (const pid of ids) {
          try {
            await ctx.runMutation(
              internal.ours.actions.removeNpcsAndPromoteStudents.leavePlayerById as any,
              { worldId: worldId as unknown as Id<'worlds'>, playerId: pid },
            );
            npcsLeft++;
          } catch { /* ignore */ }
        }
      }
      // Delete twin + card row.
      try {
        const res = await ctx.runMutation(
          internal.ours.actions.removeNpcsAndPromoteStudents.deleteTwinAndCard as any,
          { twinId: t._id as any },
        );
        if (res?.deleted) npcsDeleted++;
      } catch { /* ignore */ }
    }

    // Now promote students who aren't in the world yet.
    const studentsPromoted: string[] = [];
    const studentsSkipped: string[] = [];
    for (const t of twins) {
      if (t.isNpc) continue;
      const already = (byName.get(t.pseudonym) ?? []).length > 0;
      if (already) {
        studentsSkipped.push(`${t.pseudonym} (already in world)`);
        continue;
      }
      try {
        await ctx.runMutation(api.ours.mutations.promoteTwinToAgent.default as any, {
          twinId: t._id as any,
        });
        studentsPromoted.push(t.pseudonym);
      } catch (e) {
        studentsSkipped.push(`${t.pseudonym} (promote failed: ${(e as Error).message.slice(0, 80)})`);
      }
    }

    return { npcsLeft, npcsDeleted, studentsPromoted, studentsSkipped };
  },
});
