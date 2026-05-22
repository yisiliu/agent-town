import { action, internalMutation, internalQuery } from '../../_generated/server';
import { internal, api } from '../../_generated/api';
import { v } from 'convex/values';
import { NPC_CARDS } from '../data/npcCards';
import { parseIntro } from '../lib/parseCard';

// One-shot seeder: creates twin + card + promotes-to-agent for each entry
// in NPC_CARDS. Idempotent — skips any pseudonym that already exists.
// Bypasses the student upload + scan flow because we trust the content.
//
// Run with: bunx convex run ours/actions/seedNpcCards:default
//      or:  bunx convex run --prod ours/actions/seedNpcCards:default

export const findExistingTwin = internalQuery({
  args: { pseudonym: v.string() },
  handler: async (ctx, { pseudonym }) => {
    const t = await ctx.db
      .query('twins')
      .withIndex('pseudonym', (q) => q.eq('pseudonym', pseudonym))
      .first();
    return t ? { _id: t._id, state: t.state } : null;
  },
});

export const insertNpcTwin = internalMutation({
  args: { pseudonym: v.string(), markdown: v.string() },
  handler: async (ctx, { pseudonym, markdown }) => {
    const now = Date.now();
    const twinId = await ctx.db.insert('twins', {
      pseudonym,
      // `synth-` prefix is the existing convention recognised by
      // instructorTwinList → isSynthetic = true. Keeps NPCs out of the
      // student-only filter in the instructor dashboard.
      studentRealNameHash: `synth-npc-${pseudonym}`,
      state: 'active',
      createdAt: now,
    });
    const cardId = await ctx.db.insert('cards', {
      twinId,
      markdown,
      intro: parseIntro(markdown),
      snapshotAt: now,
      // No scans for trusted seed content.
      piiScanStatus: 'pass',
      promptInjectionScanStatus: 'pass',
    });
    await ctx.db.patch(twinId, { cardId });
    return { twinId };
  },
});

export default action({
  args: {},
  handler: async (ctx) => {
    const created: string[] = [];
    const skipped: string[] = [];
    const failed: { pseudonym: string; error: string }[] = [];

    for (const npc of NPC_CARDS) {
      const existing: { _id: string; state: string } | null = await ctx.runQuery(
        internal.ours.actions.seedNpcCards.findExistingTwin,
        { pseudonym: npc.pseudonym },
      );
      if (existing) {
        skipped.push(npc.pseudonym);
        continue;
      }
      try {
        const { twinId }: { twinId: string } = await ctx.runMutation(
          internal.ours.actions.seedNpcCards.insertNpcTwin,
          { pseudonym: npc.pseudonym, markdown: npc.markdown },
        );
        await ctx.runMutation(api.ours.mutations.promoteTwinToAgent.default, {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          twinId: twinId as any,
        });
        created.push(npc.pseudonym);
      } catch (e) {
        failed.push({ pseudonym: npc.pseudonym, error: (e as Error).message });
      }
    }

    return {
      created,
      skipped,
      failed,
      counts: { created: created.length, skipped: skipped.length, failed: failed.length },
    };
  },
});
