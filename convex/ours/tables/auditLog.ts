import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const auditLog = defineTable({
  timestamp: v.number(),
  actor: v.string(),
  actorRole: v.union(
    v.literal('instructor'),
    v.literal('student'),
    v.literal('system'),
  ),
  action: v.string(),
  target: v.optional(v.string()),
  targetTwinId: v.optional(v.id('twins')),
  before: v.optional(v.any()),
  after: v.optional(v.any()),
})
  .index('timestamp', ['timestamp'])
  .index('actor', ['actor', 'timestamp'])
  .index('targetTwin', ['targetTwinId', 'timestamp']);
