import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// 12h instructor session per spec §8.2 (twice the student TTL — the
// instructor is logged in for the duration of class plus prep, but
// rolls over daily so a forgotten browser doesn't stay live for weeks).
export const instructorSessions = defineTable({
  token: v.string(),
  instructorId: v.id('instructors'),
  role: v.literal('instructor'),
  issuedAt: v.number(),
  expiresAt: v.number(),
})
  .index('token', ['token'])
  .index('instructorId', ['instructorId'])
  .index('expiresAt', ['expiresAt']);
