import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Base item definitions — teacher-managed catalog of all items in the game
export const itemDefinitions = defineTable({
  name: v.string(),           // e.g. "种子", "面包"
  description: v.string(),   // human-readable description
  icon: v.optional(v.string()), // emoji or sprite key
  category: v.union(
    v.literal('seed'),
    v.literal('crop'),
    v.literal('food'),
    v.literal('material'),
    v.literal('misc'),
  ),
  tradeable: v.boolean(),    // can be sold in shops
})
  .index('category', ['category'])
  .index('name', ['name']);