'use node';

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { reconcileScanResults } from '../lib/uploadFlowCore';
import { prepareCode } from '../lib/authCodeStore';
import type { ScanResult } from '../lib/piiScanCore';

// Scheduled by uploadTwin. Runs both scans, reconciles, prepares
// per-pass 6-digit codes (bcrypt hashing happens here), then hands
// the outcome + prepared codes to finalizeScan.
//
// Node action because bcryptjs uses setTimeout internally, which the
// Convex V8 runtime forbids. PII + prompt-injection scans are
// invoked through ctx.runAction so the §5.1 chokepoint is honored.
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
        idempotencyKey: `injection-scan:${twinId}:${card.cardId}`,
      }),
    ])) as [ScanResult, ScanResult];

    const outcome = reconcileScanResults(pii, promptInjection);
    const scanReasons = [...pii.reasons, ...promptInjection.reasons];

    // Pre-compute bcrypt-hashed codes on pass so the finalizeScan
    // mutation only does DB writes (V8 runtime can't run bcrypt).
    const preparedCodes =
      outcome.decision === 'pass'
        ? {
            spectate: await prepareCode(),
            control: await prepareCode(),
            edit: await prepareCode(),
          }
        : undefined;

    await ctx.runMutation(ref.ours.mutations.finalizeScan.default, {
      twinId,
      uploadSessionToken,
      outcome,
      piiDecision: pii.decision,
      promptInjectionDecision: promptInjection.decision,
      scanReasons,
      now: Date.now(),
      preparedCodes,
    });

    // Auto-promote: as soon as a twin passes the scans, push it straight
    // into the default town. Skips the instructor "approve" click — the
    // student's upload UI flow becomes upload→codes-displayed→already-in-town.
    if (outcome.decision === 'pass') {
      try {
        await ctx.runMutation(ref.ours.mutations.promoteTwinToAgent.default, {
          twinId,
        });
      } catch (e) {
        // Don't break the upload flow if promotion fails — the twin is
        // still active and the instructor can promote manually from the
        // dashboard. Log it for diagnosis.
        console.warn(
          `runTwinScans: auto-promote failed for ${twinId}: ${(e as Error).message}`,
        );
      }
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
  },
});
