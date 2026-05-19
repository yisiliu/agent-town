import type {
  DataModelFromSchemaDefinition,
  GenericMutationCtx,
} from 'convex/server';
import type schema from '../../schema';
import { writePreparedCode, type PreparedCode } from './authCodeStore';
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
  // Required when outcome.decision === 'pass'. Bcrypt hashing must
  // happen in the caller (a Node action) because Convex's V8 mutation
  // runtime forbids setTimeout, which bcryptjs uses internally.
  preparedCodes?: {
    spectate: PreparedCode;
    control: PreparedCode;
    edit: PreparedCode;
  };
}

export type FinalizeScanResult =
  | { state: 'active' }
  | { state: 'rejected' };

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
    if (!args.preparedCodes) {
      throw new Error(
        'finalizeScan: preparedCodes required on pass — caller must hash codes before invoking',
      );
    }
    await ctx.db.patch(args.twinId, { state: 'active' });
    await Promise.all([
      writePreparedCode(
        ctx,
        args.twinId,
        'spectate',
        args.preparedCodes.spectate.hash,
        args.now,
      ),
      writePreparedCode(
        ctx,
        args.twinId,
        'control',
        args.preparedCodes.control.hash,
        args.now,
      ),
      writePreparedCode(
        ctx,
        args.twinId,
        'edit',
        args.preparedCodes.edit.hash,
        args.now,
      ),
    ]);
    await recordActive(ctx, {
      uploadSessionToken: args.uploadSessionToken,
      codes: {
        spectate: args.preparedCodes.spectate.plaintext,
        control: args.preparedCodes.control.plaintext,
        edit: args.preparedCodes.edit.plaintext,
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
