import type {
  DataModelFromSchemaDefinition,
  GenericMutationCtx,
} from 'convex/server';
import type schema from '../../schema';
import { issueCodeFor } from './authCodeStore';
import { recordActive, recordRejected } from './uploadResultsStore';
import type { FinalOutcome } from './uploadFlowCore';

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
type MutationCtx = GenericMutationCtx<DataModel>;
type TwinId = DataModel['twins']['document']['_id'];
type ScanStatus = 'pass' | 'block' | 'manual_review';

export interface FinalizeScanArgs {
  twinId: TwinId;
  uploadSessionToken: string;
  outcome: FinalOutcome;
  piiDecision: ScanStatus;
  promptInjectionDecision: ScanStatus;
  scanReasons: string[];
  now: number;
}

export type FinalizeScanResult =
  | { state: 'active' }
  | { state: 'rejected' };

// Extracted from convex/ours/mutations/finalizeScan.ts so the upload
// pipeline can be tested end-to-end via convexTest's t.run without
// invoking the mutation through a function reference (the stubbed
// _generated/api can't resolve action/mutation refs until convex
// codegen runs against a real deployment).
export async function finalizeScanCore(
  ctx: MutationCtx,
  args: FinalizeScanArgs,
): Promise<FinalizeScanResult> {
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
    return { state: 'active' };
  }

  await ctx.db.patch(args.twinId, { state: 'rejected' });
  await recordRejected(ctx, {
    uploadSessionToken: args.uploadSessionToken,
    errors: args.outcome.errors,
    now: args.now,
  });
  return { state: 'rejected' };
}
