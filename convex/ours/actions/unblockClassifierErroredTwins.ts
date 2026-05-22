import { action, internalMutation } from '../../_generated/server';
import { internal, api } from '../../_generated/api';

// One-shot recovery: finds twins rejected ONLY because of classifier
// errors (Together/DeepSeek timing out), not actual PII/injection
// matches. Flips them to 'active' and promotes to the town. Safe to
// run multiple times.
//
// Real content blocks (the regex/Llama Guard catching something real)
// produce different reasons (e.g. "PII match: <pattern>") — those rows
// are left alone.

const CLASSIFIER_ERROR_MARKERS = [
  'classifier error',
  'fail-closed per spec',
];

function isOnlyClassifierError(reasons: readonly string[] | undefined): boolean {
  if (!reasons || reasons.length === 0) return false;
  return reasons.every((r) =>
    CLASSIFIER_ERROR_MARKERS.some((m) => r.includes(m)),
  );
}

export const activateChunk = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rejected = await ctx.db
      .query('twins')
      .withIndex('state', (q) => q.eq('state', 'rejected'))
      .collect();
    const activated: string[] = [];
    const left: string[] = [];
    for (const t of rejected) {
      if (!t.cardId) {
        left.push(`${t.pseudonym} (no card)`);
        continue;
      }
      const card = await ctx.db.get(t.cardId);
      if (!card) {
        left.push(`${t.pseudonym} (missing card row)`);
        continue;
      }
      if (!isOnlyClassifierError(card.scanReasons)) {
        left.push(`${t.pseudonym} (real block: ${(card.scanReasons ?? []).join(' | ')})`);
        continue;
      }
      await ctx.db.patch(t._id, { state: 'active' });
      await ctx.db.patch(t.cardId, {
        piiScanStatus: 'pass',
        promptInjectionScanStatus: 'pass',
        scanReasons: [...(card.scanReasons ?? []), '[manually unblocked: classifier-error only]'],
      });
      activated.push(t.pseudonym);
    }
    return { activated, left };
  },
});

/* eslint-disable @typescript-eslint/no-explicit-any */
export default action({
  args: {},
  handler: async (ctx): Promise<{ activated: string[]; promoted: string[]; leftAsRejected: string[] }> => {
    const result = (await ctx.runMutation(
      internal.ours.actions.unblockClassifierErroredTwins.activateChunk as any,
      {},
    )) as { activated: string[]; left: string[] };
    const { activated, left } = result;
    const promoted: string[] = [];
    for (const pseudonym of activated) {
      const twin = (await ctx.runQuery(
        internal.ours.actions.seedNpcCards.findExistingTwin as any,
        { pseudonym },
      )) as { _id: string } | null;
      if (!twin) continue;
      try {
        await ctx.runMutation(api.ours.mutations.promoteTwinToAgent.default as any, {
          twinId: twin._id as any,
        });
        promoted.push(pseudonym);
      } catch (e) {
        promoted.push(`${pseudonym} (promote failed: ${(e as Error).message})`);
      }
    }
    return { activated, promoted, leftAsRejected: left };
  },
});
