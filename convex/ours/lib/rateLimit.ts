import type {
  DataModelFromSchemaDefinition,
  GenericMutationCtx,
} from 'convex/server';
import type schema from '../../schema';

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
type MutationCtx = GenericMutationCtx<DataModel>;
type Bucket = 'ip_minute' | 'ip_hour' | 'pseudonym_lockout';

// Spec §8.2 thresholds. Bucket durations match the bucket name.
export const IP_MINUTE_CAP = 5;
export const IP_HOUR_CAP = 20;
export const PSEUDONYM_LOCKOUT_THRESHOLD = 10;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export interface AttemptKey {
  ip: string;
  pseudonym: string;
}

export interface CheckResult {
  allowed: boolean;
  reason?: string;
}

async function loadRow(ctx: MutationCtx, bucket: Bucket, key: string) {
  return ctx.db
    .query('rateLimits')
    .withIndex('bucket_key', (q) => q.eq('bucket', bucket).eq('key', key))
    .unique();
}

function bucketDuration(bucket: Bucket): number | null {
  if (bucket === 'ip_minute') return MINUTE_MS;
  if (bucket === 'ip_hour') return HOUR_MS;
  return null;
}

function isWindowExpired(
  bucket: Bucket,
  windowStart: number,
  now: number,
): boolean {
  const dur = bucketDuration(bucket);
  return dur !== null && now - windowStart >= dur;
}

// Pure read for the gating decision. Returns allowed:false with a
// reason string when ANY of the three buckets is over its cap. No
// writes — call recordAttempt afterwards if you want the counters
// (and the row) to advance.
export async function checkRateLimit(
  ctx: MutationCtx,
  key: AttemptKey,
  now: number,
): Promise<CheckResult> {
  // Pseudonym lockout is sticky. Check first so a locked pseudonym is
  // never reactivated by a new IP.
  const lockRow = await loadRow(ctx, 'pseudonym_lockout', key.pseudonym);
  if (lockRow?.locked) {
    return { allowed: false, reason: 'pseudonym locked — instructor unlock required' };
  }

  const minuteRow = await loadRow(ctx, 'ip_minute', key.ip);
  if (
    minuteRow &&
    !isWindowExpired('ip_minute', minuteRow.windowStart, now) &&
    minuteRow.attempts >= IP_MINUTE_CAP
  ) {
    return { allowed: false, reason: 'minute window cap exceeded' };
  }

  const hourRow = await loadRow(ctx, 'ip_hour', key.ip);
  if (
    hourRow &&
    !isWindowExpired('ip_hour', hourRow.windowStart, now) &&
    hourRow.attempts >= IP_HOUR_CAP
  ) {
    return { allowed: false, reason: 'hour window cap exceeded' };
  }

  return { allowed: true };
}

async function upsertWindowRow(
  ctx: MutationCtx,
  bucket: Bucket,
  key: string,
  now: number,
  isFailure: boolean,
) {
  const dur = bucketDuration(bucket);
  const existing = await loadRow(ctx, bucket, key);

  // Rolling-window reset: if the window expired, start a fresh row.
  const expired =
    existing !== null &&
    dur !== null &&
    now - existing.windowStart >= dur;

  if (!existing || expired) {
    const fresh = {
      bucket,
      key,
      windowStart: now,
      attempts: 1,
      failedAttempts: isFailure ? 1 : 0,
      locked: false,
      lastAttemptAt: now,
    };
    if (existing) {
      await ctx.db.replace(existing._id, fresh);
    } else {
      await ctx.db.insert('rateLimits', fresh);
    }
    return;
  }

  await ctx.db.patch(existing._id, {
    attempts: existing.attempts + 1,
    failedAttempts: existing.failedAttempts + (isFailure ? 1 : 0),
    lastAttemptAt: now,
  });
}

// Bumps the IP windows and (on failure) the pseudonym lockout counter.
// `rejected: true` indicates this attempt was blocked by the gate — we
// still record it so the forensic counters reflect the real blast
// pattern, not just the allowed traffic.
export async function recordAttempt(
  ctx: MutationCtx,
  key: AttemptKey,
  success: boolean,
  now: number,
  opts: { rejected?: boolean } = {},
): Promise<void> {
  // Rejected attempts log against the IP windows so brute-force surface
  // remains visible, but they never advance the lockout counter (the
  // attempt didn't actually reach verification).
  await upsertWindowRow(ctx, 'ip_minute', key.ip, now, !success);
  await upsertWindowRow(ctx, 'ip_hour', key.ip, now, !success);

  if (success || opts.rejected) return;

  // Lockout bucket: only real verification failures advance it.
  const existing = await loadRow(ctx, 'pseudonym_lockout', key.pseudonym);
  if (!existing) {
    const failedAttempts = 1;
    await ctx.db.insert('rateLimits', {
      bucket: 'pseudonym_lockout',
      key: key.pseudonym,
      windowStart: now,
      attempts: 1,
      failedAttempts,
      locked: failedAttempts >= PSEUDONYM_LOCKOUT_THRESHOLD,
      lastAttemptAt: now,
    });
    return;
  }

  const nextFailed = existing.failedAttempts + 1;
  await ctx.db.patch(existing._id, {
    attempts: existing.attempts + 1,
    failedAttempts: nextFailed,
    locked: existing.locked || nextFailed >= PSEUDONYM_LOCKOUT_THRESHOLD,
    lastAttemptAt: now,
  });
}

// Instructor action — clears the persistent lockout counter for a
// pseudonym. Task 27 wires this into the admin UI.
export async function unlockPseudonym(
  ctx: MutationCtx,
  pseudonym: string,
  now: number,
): Promise<void> {
  const existing = await loadRow(ctx, 'pseudonym_lockout', pseudonym);
  if (!existing) return;
  await ctx.db.patch(existing._id, {
    locked: false,
    failedAttempts: 0,
    lastAttemptAt: now,
  });
}
