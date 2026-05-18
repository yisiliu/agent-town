import type {
  DataModelFromSchemaDefinition,
  GenericMutationCtx,
  GenericQueryCtx,
} from 'convex/server';
import type schema from '../../schema';

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
type MutationCtx = GenericMutationCtx<DataModel>;
type QueryCtx = GenericQueryCtx<DataModel>;
type TwinId = DataModel['twins']['document']['_id'];

// 1 hour TTL on a pending-or-completed result row. The user has to
// confirm seeing their codes within an hour of upload; after that the
// row auto-expires and they must reissue via instructor support.
export const UPLOAD_RESULT_TTL_MS = 60 * 60 * 1_000;

export function generateUploadSessionToken(): string {
  // 32-byte url-safe random token via web crypto (works in Convex V8
  // isolate). Same format as the student session token in lib/session.ts.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

export async function recordPending(
  ctx: MutationCtx,
  args: { uploadSessionToken: string; twinId: TwinId; now: number },
): Promise<void> {
  await ctx.db.insert('uploadResults', {
    uploadSessionToken: args.uploadSessionToken,
    twinId: args.twinId,
    state: 'pending',
    createdAt: args.now,
    expiresAt: args.now + UPLOAD_RESULT_TTL_MS,
  });
}

export async function recordActive(
  ctx: MutationCtx,
  args: {
    uploadSessionToken: string;
    codes: { spectate: string; control: string; edit: string };
    now: number;
  },
): Promise<void> {
  const row = await ctx.db
    .query('uploadResults')
    .withIndex('uploadSessionToken', (q) =>
      q.eq('uploadSessionToken', args.uploadSessionToken),
    )
    .unique();
  if (!row) throw new Error('uploadResults: no row for token');
  await ctx.db.patch(row._id, {
    state: 'active',
    codes: args.codes,
    expiresAt: args.now + UPLOAD_RESULT_TTL_MS,
  });
}

export async function recordRejected(
  ctx: MutationCtx,
  args: {
    uploadSessionToken: string;
    errors: string[];
    now: number;
  },
): Promise<void> {
  const row = await ctx.db
    .query('uploadResults')
    .withIndex('uploadSessionToken', (q) =>
      q.eq('uploadSessionToken', args.uploadSessionToken),
    )
    .unique();
  if (!row) throw new Error('uploadResults: no row for token');
  await ctx.db.patch(row._id, {
    state: 'rejected',
    errors: args.errors,
    expiresAt: args.now + UPLOAD_RESULT_TTL_MS,
  });
}

export async function readUploadResult(
  ctx: QueryCtx,
  uploadSessionToken: string,
  now: number,
) {
  const row = await ctx.db
    .query('uploadResults')
    .withIndex('uploadSessionToken', (q) =>
      q.eq('uploadSessionToken', uploadSessionToken),
    )
    .unique();
  if (!row) return null;
  if (now >= row.expiresAt) return null;
  return {
    state: row.state,
    codes: row.codes,
    errors: row.errors,
  };
}

export async function clearUploadResult(
  ctx: MutationCtx,
  uploadSessionToken: string,
): Promise<boolean> {
  const row = await ctx.db
    .query('uploadResults')
    .withIndex('uploadSessionToken', (q) =>
      q.eq('uploadSessionToken', uploadSessionToken),
    )
    .unique();
  if (!row) return false;
  await ctx.db.delete(row._id);
  return true;
}
