import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const reflections = defineTable({
  twinId: v.id('twins'),
  prompt: v.string(),
  body: v.string(),
  writtenAt: v.number(),
  assignmentId: v.optional(v.string()),
})
  .index('twinId', ['twinId'])
  .index('assignment', ['assignmentId', 'twinId']);
