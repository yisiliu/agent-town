import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const objects = defineTable({
  type: v.string(),
  payload: v.string(),
  location: v.object({ x: v.number(), y: v.number() }),
  spawnedBy: v.string(),
  spawnedAt: v.number(),
  despawnedAt: v.optional(v.number()),
})
  .index('spawnedAt', ['spawnedAt'])
  .index('active', ['despawnedAt']);
