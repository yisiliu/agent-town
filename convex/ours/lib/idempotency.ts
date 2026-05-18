import type {
  DataModelFromSchemaDefinition,
  GenericMutationCtx,
  GenericQueryCtx,
} from 'convex/server';
import type schema from '../../schema';
import { IDEMPOTENCY_TTL_MS } from './llmRouterCore';

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
type MutationCtx = GenericMutationCtx<DataModel>;
type QueryCtx = GenericQueryCtx<DataModel>;

export async function lookupCachedResponse(
  ctx: QueryCtx,
  agentId: string,
  idempotencyKey: string,
  now: number,
): Promise<{ response: string } | null> {
  const row = await ctx.db
    .query('llmCallIdempotency')
    .withIndex('agent_key', (q) =>
      q.eq('agentId', agentId).eq('idempotencyKey', idempotencyKey),
    )
    .unique();
  if (!row) return null;
  if (now >= row.expiresAt) return null;
  return { response: row.response };
}

export async function persistCachedResponse(
  ctx: MutationCtx,
  args: {
    agentId: string;
    idempotencyKey: string;
    callType: string;
    response: string;
    tier: 'frontier' | 'local';
    now: number;
  },
): Promise<void> {
  const existing = await ctx.db
    .query('llmCallIdempotency')
    .withIndex('agent_key', (q) =>
      q.eq('agentId', args.agentId).eq('idempotencyKey', args.idempotencyKey),
    )
    .unique();

  const row = {
    agentId: args.agentId,
    idempotencyKey: args.idempotencyKey,
    callType: args.callType,
    response: args.response,
    tier: args.tier,
    cachedAt: args.now,
    expiresAt: args.now + IDEMPOTENCY_TTL_MS,
  };

  if (existing) {
    await ctx.db.replace(existing._id, row);
  } else {
    await ctx.db.insert('llmCallIdempotency', row);
  }
}
