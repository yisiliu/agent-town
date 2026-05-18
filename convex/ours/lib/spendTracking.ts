import type {
  DataModelFromSchemaDefinition,
  GenericMutationCtx,
  GenericQueryCtx,
} from 'convex/server';
import type schema from '../../schema';

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
type MutationCtx = GenericMutationCtx<DataModel>;
type QueryCtx = GenericQueryCtx<DataModel>;

// UTC-day bucket key. We pick UTC over local time so a class running
// across midnight in any timezone still gets one bucket per "day" by a
// consistent rule. Implementations elsewhere should NOT recompute this
// inline — the kill-switch's correctness depends on lookup and write
// using the same bucket function.
export function dateUtcBucket(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export async function getDailySpendUsd(
  ctx: QueryCtx,
  agentId: string,
  now: number,
): Promise<number> {
  const row = await ctx.db
    .query('agentDailySpend')
    .withIndex('agent_date', (q) =>
      q.eq('agentId', agentId).eq('dateUtc', dateUtcBucket(now)),
    )
    .unique();
  return row?.costUsd ?? 0;
}

export async function addDailySpendUsd(
  ctx: MutationCtx,
  args: { agentId: string; costUsd: number; now: number },
): Promise<void> {
  const bucket = dateUtcBucket(args.now);
  const existing = await ctx.db
    .query('agentDailySpend')
    .withIndex('agent_date', (q) =>
      q.eq('agentId', args.agentId).eq('dateUtc', bucket),
    )
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      costUsd: existing.costUsd + args.costUsd,
      lastUpdated: args.now,
    });
  } else {
    await ctx.db.insert('agentDailySpend', {
      agentId: args.agentId,
      dateUtc: bucket,
      costUsd: args.costUsd,
      lastUpdated: args.now,
    });
  }
}
