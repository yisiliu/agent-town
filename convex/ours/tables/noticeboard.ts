import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const noticeboard = defineTable({
  title: v.string(),
  body: v.string(),
  postedBy: v.string(),
  postedAt: v.number(),
  kind: v.union(
    v.literal('announcement'),
    v.literal('game_opt_in'),
    v.literal('world_event'),
  ),
  interactionId: v.optional(v.id('interactions')),
  optInDeadline: v.optional(v.number()),
})
  .index('postedAt', ['postedAt'])
  .index('kind', ['kind']);
