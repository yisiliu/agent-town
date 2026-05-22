import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const cards = defineTable({
  twinId: v.id('twins'),
  markdown: v.string(),
  // Short self-introduction parsed from the markdown (YAML frontmatter
  // intro:, ## 简介 heading, or first paragraph fallback). Shown in the
  // town's player-details sidebar so other agents don't see the full
  // card dump. Optional for backward compat with cards uploaded before
  // this field existed — promoteTwinToAgent re-parses on demand.
  intro: v.optional(v.string()),
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
