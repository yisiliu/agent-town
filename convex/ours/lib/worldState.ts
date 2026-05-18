import type {
  DataModelFromSchemaDefinition,
  GenericMutationCtx,
  GenericQueryCtx,
} from 'convex/server';
import type schema from '../../schema';
import type { WorldStatus, WorldState } from './sessionWindowCore';

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
type MutationCtx = GenericMutationCtx<DataModel>;
type QueryCtx = GenericQueryCtx<DataModel>;

async function readRow(ctx: QueryCtx) {
  return ctx.db.query('worldState').first();
}

export async function readWorldStatus(ctx: QueryCtx): Promise<WorldStatus> {
  const row = await readRow(ctx);
  if (!row) return { state: 'frozen', nextChange: null };
  return { state: row.state, nextChange: row.nextChange };
}

export async function readNextSessionStart(
  ctx: QueryCtx,
): Promise<number | null> {
  const row = await readRow(ctx);
  return row?.nextSessionStart ?? null;
}

interface ApplyArgs {
  state: WorldState;
  nextChange: number | null;
  nextSessionStart?: number | null;
  now: number;
}

export async function applyScheduledStatus(
  ctx: MutationCtx,
  args: ApplyArgs,
): Promise<void> {
  const row = await readRow(ctx);
  const desiredNextSessionStart =
    args.nextSessionStart ?? (args.state === 'frozen' ? args.nextChange : null);

  if (!row) {
    await ctx.db.insert('worldState', {
      state: args.state,
      nextChange: args.nextChange,
      nextSessionStart: desiredNextSessionStart,
      lastChangedAt: args.now,
      lastChangedBy: 'cron',
    });
    return;
  }

  // Instructor-owned override: the cron does NOT flip back until the
  // schedule independently agrees with what the instructor chose. Once
  // schedule and override agree, ownership reverts to the cron so
  // subsequent transitions flow normally.
  if (row.lastChangedBy === 'instructor' && row.state !== args.state) {
    // Keep override; update next-change projection so UI countdown still
    // points at the upcoming scheduled flip.
    await ctx.db.patch(row._id, {
      nextChange: args.nextChange,
      nextSessionStart: desiredNextSessionStart,
    });
    return;
  }

  if (row.state === args.state) {
    // No flip — just refresh the projection if it drifted.
    if (
      row.nextChange !== args.nextChange ||
      row.nextSessionStart !== desiredNextSessionStart ||
      row.lastChangedBy !== 'cron'
    ) {
      await ctx.db.patch(row._id, {
        nextChange: args.nextChange,
        nextSessionStart: desiredNextSessionStart,
        lastChangedBy: 'cron',
      });
    }
    return;
  }

  // Cron-owned flip.
  await ctx.db.patch(row._id, {
    state: args.state,
    nextChange: args.nextChange,
    nextSessionStart: desiredNextSessionStart,
    lastChangedAt: args.now,
    lastChangedBy: 'cron',
  });
}

export async function manualFreeze(
  ctx: MutationCtx,
  args: { now: number },
): Promise<void> {
  await writeOverride(ctx, 'frozen', args.now);
}

export async function manualResume(
  ctx: MutationCtx,
  args: { now: number },
): Promise<void> {
  await writeOverride(ctx, 'live', args.now);
}

async function writeOverride(
  ctx: MutationCtx,
  state: WorldState,
  now: number,
): Promise<void> {
  const row = await readRow(ctx);
  if (!row) {
    await ctx.db.insert('worldState', {
      state,
      nextChange: null,
      nextSessionStart: null,
      lastChangedAt: now,
      lastChangedBy: 'instructor',
    });
    return;
  }
  await ctx.db.patch(row._id, {
    state,
    lastChangedAt: now,
    lastChangedBy: 'instructor',
  });
}
