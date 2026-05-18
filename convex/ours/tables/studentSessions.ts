import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// 24h student session per spec §8.2. Token is opaque, generated with
// the Web Crypto RNG and stored as the raw value (queries hit the
// token index by exact match). At-rest exposure of the token row is
// equivalent to credential leakage of an active session, so the row
// has a short TTL — the cleanup cron lands in Task 31.
export const studentSessions = defineTable({
  token: v.string(),
  twinId: v.id('twins'),
  scope: v.union(
    v.literal('spectate'),
    v.literal('control'),
    v.literal('edit'),
  ),
  issuedAt: v.number(),
  expiresAt: v.number(),
  createdFromIp: v.optional(v.string()),
})
  .index('token', ['token'])
  .index('twinId', ['twinId'])
  .index('expiresAt', ['expiresAt']);
