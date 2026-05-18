import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const digests = defineTable({
  twinId: v.id('twins'),
  sessionStart: v.number(),
  sessionEnd: v.number(),
  status: v.union(
    v.literal('pending_approval'),
    v.literal('approved'),
    v.literal('rejected'),
    v.literal('partially_approved'),
  ),
  builtAt: v.number(),
  approvedAt: v.optional(v.number()),
})
  .index('twinId', ['twinId'])
  .index('twin_session', ['twinId', 'sessionStart']);
