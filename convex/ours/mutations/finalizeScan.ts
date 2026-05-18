import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { recordActive, recordRejected } from '../lib/uploadResultsStore';
import { issueCodeFor } from '../lib/authCodeStore';

// Called by runTwinScans after both scans complete. On a pass outcome:
// flips twin → active, sets card scan statuses to 'pass', issues the
// three plaintext codes and stores them in uploadResults for the UI to
// read once. On a block outcome: flips twin → rejected, stores error
// reasons. Idempotency: a second call with the same outcome is harmless
// — twin state will already be active/rejected.
export default internalMutation({
  args: {
    twinId: v.id('twins'),
    uploadSessionToken: v.string(),
    outcome: v.union(
      v.object({ decision: v.literal('pass') }),
      v.object({
        decision: v.literal('block'),
        errors: v.array(v.string()),
      }),
    ),
    // Raw per-scan results for cards row update + audit log.
    piiDecision: v.union(
      v.literal('pass'),
      v.literal('block'),
      v.literal('manual_review'),
    ),
    promptInjectionDecision: v.union(
      v.literal('pass'),
      v.literal('block'),
      v.literal('manual_review'),
    ),
    scanReasons: v.array(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const twin = await ctx.db.get(args.twinId);
    if (!twin) throw new Error('finalizeScan: twin not found');
    if (twin.cardId) {
      await ctx.db.patch(twin.cardId, {
        piiScanStatus: args.piiDecision,
        promptInjectionScanStatus: args.promptInjectionDecision,
        scanReasons: args.scanReasons,
      });
    }

    if (args.outcome.decision === 'pass') {
      await ctx.db.patch(args.twinId, { state: 'active' });
      const [spectate, control, edit] = await Promise.all([
        issueCodeFor(ctx, args.twinId, 'spectate'),
        issueCodeFor(ctx, args.twinId, 'control'),
        issueCodeFor(ctx, args.twinId, 'edit'),
      ]);
      await recordActive(ctx, {
        uploadSessionToken: args.uploadSessionToken,
        codes: {
          spectate: spectate.plaintext,
          control: control.plaintext,
          edit: edit.plaintext,
        },
        now: args.now,
      });
      return { state: 'active' as const };
    }

    await ctx.db.patch(args.twinId, { state: 'rejected' });
    await recordRejected(ctx, {
      uploadSessionToken: args.uploadSessionToken,
      errors: args.outcome.errors,
      now: args.now,
    });
    return { state: 'rejected' as const };
  },
});
