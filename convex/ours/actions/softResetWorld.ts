import { action, internalMutation } from '../../_generated/server';
import { internal, api } from '../../_generated/api';
import { v } from 'convex/values';
import schema from '../../schema';
import type { TableNames } from '../../_generated/dataModel';

// Force-reset the town WITHOUT touching student uploads. Wipes only
// the world-runtime tables (engine state, players, conversations,
// memories, embeddings, interactions, etc.) and preserves twins +
// cards + auth codes + student sessions + instructor records.
//
// After the wipe: re-runs init to create a fresh world, re-applies
// the AiBuddy map, sets state=live + engine running, then re-promotes
// every active student twin back into the new town.

// Tables that survive the reset. Anything not in this set gets cleared.
const PRESERVE: ReadonlyArray<TableNames> = [
  'twins',
  'cards',
  'authCodes',
  'uploadResults',
  'studentSessions',
  'instructors',
  'instructorAuthenticators',
  'instructorChallenges',
  'instructorSessions',
  'consents',
  'objects',
  'digests',
  'retractions',
  'auditLog',
  'rateLimits',
  'crossBorderTransfers',
  // Persona-genned chat caches stay so re-promoted students keep their
  // existing cost/idempotency records. Not strictly required.
  'llmCallIdempotency',
  'agentDailySpend',
];

const CHUNK = 200;

export const wipeChunk = internalMutation({
  args: { tableName: v.string() },
  handler: async (ctx, { tableName }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await ctx.db.query(tableName as any).take(CHUNK);
    for (const r of rows) await ctx.db.delete(r._id);
    return { tableName, deleted: rows.length, more: rows.length === CHUNK };
  },
});

export const collectActiveStudentTwins = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('twins')
      .withIndex('state', (q) => q.eq('state', 'active'))
      .collect();
    return rows
      .filter((r) => !r.studentRealNameHash.startsWith('synth-'))
      .map((r) => ({ _id: r._id as unknown as string, pseudonym: r.pseudonym }));
  },
});

/* eslint-disable @typescript-eslint/no-explicit-any */
export default action({
  args: {},
  handler: async (ctx): Promise<{
    wiped: { table: string; deleted: number }[];
    rePromoted: string[];
    failedPromotes: string[];
  }> => {
    // 1. Wipe each non-preserved table in chunks.
    const preserveSet = new Set<string>(PRESERVE);
    const tables = Object.keys((schema as any).tables) as string[];
    const wiped: { table: string; deleted: number }[] = [];
    for (const t of tables) {
      if (preserveSet.has(t)) continue;
      let total = 0;
      for (let i = 0; i < 100; i++) {
        const res: { tableName: string; deleted: number; more: boolean } =
          await ctx.runMutation(
            internal.ours.actions.softResetWorld.wipeChunk as any,
            { tableName: t },
          );
        total += res.deleted;
        if (!res.more) break;
      }
      wiped.push({ table: t, deleted: total });
    }

    // 2. Re-init the world (init creates worldStatus, engine, default map).
    await ctx.runMutation((api as any).init.default, { numAgents: 0 });

    // 3. Swap to AiBuddy map.
    await ctx.runMutation(
      api.ours.mutations.swapMap.default as any,
      {},
    );

    // 4. Flip the worldState row to 'live' so the engine tick gate opens.
    await ctx.runMutation(
      api.ours.mutations.devForceResumeWorld.default as any,
      {},
    );

    // 5. Re-promote every active student twin into the fresh world.
    const students = (await ctx.runMutation(
      internal.ours.actions.softResetWorld.collectActiveStudentTwins as any,
      {},
    )) as { _id: string; pseudonym: string }[];

    const rePromoted: string[] = [];
    const failedPromotes: string[] = [];
    for (const s of students) {
      try {
        await ctx.runMutation(api.ours.mutations.promoteTwinToAgent.default as any, {
          twinId: s._id as any,
        });
        rePromoted.push(s.pseudonym);
      } catch (e) {
        failedPromotes.push(`${s.pseudonym}: ${(e as Error).message.slice(0, 100)}`);
      }
    }

    return { wiped, rePromoted, failedPromotes };
  },
});
