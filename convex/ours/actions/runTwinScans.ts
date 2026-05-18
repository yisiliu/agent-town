import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { reconcileScanResults } from '../lib/uploadFlowCore';
import type { ScanResult } from '../lib/piiScanCore';

// Scheduled by uploadTwin. Runs both scans, reconciles the result via
// reconcileScanResults, then hands the outcome to finalizeScan. Each
// scan is invoked through ctx.runAction so the §5.1 chokepoint is
// honored for the PII LLM hop.
export default internalAction({
  args: { twinId: v.id('twins') },
  handler: async (ctx, { twinId }) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ref = internal as any;

    const card = (await ctx.runQuery(
      ref.ours.queries.getCardForScan.default,
      { twinId },
    )) as { cardId: string; markdown: string } | null;
    if (!card) throw new Error('runTwinScans: no card for twin');

    const uploadSessionToken = (await ctx.runQuery(
      ref.ours.queries.uploadResultByToken.tokenForTwin,
      { twinId },
    )) as string | null;
    if (!uploadSessionToken) {
      throw new Error('runTwinScans: no uploadSessionToken for twin');
    }

    // Idempotency key for the PII LLM call: tied to the card content
    // so a retry of the scan reuses the cached classifier verdict.
    const idempotencyKey = `pii-scan:${twinId}:${card.cardId}`;

    const [pii, promptInjection] = (await Promise.all([
      ctx.runAction(ref.ours.actions.piiScan.default, {
        text: card.markdown,
        idempotencyKey,
      }),
      ctx.runAction(ref.ours.actions.promptInjectionScan.default, {
        text: card.markdown,
      }),
    ])) as [ScanResult, ScanResult];

    const outcome = reconcileScanResults(pii, promptInjection);
    const scanReasons = [...pii.reasons, ...promptInjection.reasons];

    await ctx.runMutation(ref.ours.mutations.finalizeScan.default, {
      twinId,
      uploadSessionToken,
      outcome,
      piiDecision: pii.decision,
      promptInjectionDecision: promptInjection.decision,
      scanReasons,
      now: Date.now(),
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */
  },
});
