import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// One row per (bucket, key). The bucket discriminator picks the policy:
//   ip_minute        → rolling 60s window, 5 attempt cap
//   ip_hour          → rolling 3600s window, 20 attempt cap
//   pseudonym_lockout→ persistent counter, locks at 10 failed attempts
//
// `attempts` counts every check (pass or fail); `failedAttempts` only
// counts failures and is what feeds the lockout threshold. For the
// rolling windows, the counters reset when now - windowStart exceeds
// the bucket duration. For lockout, windowStart is the issue time and
// the row is never auto-reset — an instructor unlock mutation clears it.
export const rateLimits = defineTable({
  bucket: v.union(
    v.literal('ip_minute'),
    v.literal('ip_hour'),
    v.literal('pseudonym_lockout'),
  ),
  key: v.string(),
  windowStart: v.number(),
  attempts: v.number(),
  failedAttempts: v.number(),
  locked: v.boolean(),
  lastAttemptAt: v.number(),
})
  .index('bucket_key', ['bucket', 'key'])
  .index('locked_bucket', ['locked', 'bucket']);
