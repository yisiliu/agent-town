import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const retractions = defineTable({
  twinId: v.id('twins'),
  targetType: v.union(
    v.literal('gameTurn'),
    v.literal('message'),
    v.literal('memory'),
    v.literal('digestMoment'),
    v.literal('observation'),
  ),
  targetId: v.string(),
  reason: v.optional(v.string()),
  retractedAt: v.number(),
})
  .index('twinId', ['twinId'])
  .index('target', ['targetType', 'targetId']);
