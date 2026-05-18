import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const rateLimits = defineTable({
  scope: v.union(
    v.literal('ip'),
    v.literal('pseudonym'),
    v.literal('ip_pseudonym'),
  ),
  key: v.string(),
  windowStart: v.number(),
  attempts: v.number(),
  failedAttempts: v.number(),
  locked: v.boolean(),
  lastAttemptAt: v.number(),
})
  .index('scope_key_window', ['scope', 'key', 'windowStart'])
  .index('locked_pseudonyms', ['locked', 'scope']);
