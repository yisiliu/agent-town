import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const cards = defineTable({
  twinId: v.id('twins'),
  markdown: v.string(),
  snapshotAt: v.number(),
  piiScanStatus: v.optional(
    v.union(
      v.literal('pending'),
      v.literal('pass'),
      v.literal('block'),
      v.literal('manual_review'),
    ),
  ),
  promptInjectionScanStatus: v.optional(
    v.union(
      v.literal('pending'),
      v.literal('pass'),
      v.literal('block'),
      v.literal('manual_review'),
    ),
  ),
  scanReasons: v.optional(v.array(v.string())),
})
  .index('twinId', ['twinId'])
  .index('twin_snapshot', ['twinId', 'snapshotAt']);
