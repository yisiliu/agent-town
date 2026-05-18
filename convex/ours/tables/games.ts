import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const games = defineTable({
  variant: v.literal('decrypto'),
  teamA: v.array(v.id('twins')),
  teamB: v.array(v.id('twins')),
  pool: v.string(),
  seed: v.number(),
  state: v.union(
    v.literal('lobby'),
    v.literal('setup'),
    v.literal('in_progress'),
    v.literal('ended'),
    v.literal('cancelled'),
  ),
  scoreA: v.number(),
  scoreB: v.number(),
  scheduledFor: v.number(),
  startedAt: v.optional(v.number()),
  endedAt: v.optional(v.number()),
  scheduledBy: v.string(),
})
  .index('state', ['state'])
  .index('scheduledFor', ['scheduledFor']);
