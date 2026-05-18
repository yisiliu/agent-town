import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const twins = defineTable({
  pseudonym: v.string(),
  studentRealNameHash: v.string(),
  cardId: v.optional(v.id('cards')),
  avatarStorageId: v.optional(v.string()),
  state: v.union(
    v.literal('pending_scan'),
    v.literal('active'),
    v.literal('suspended'),
    v.literal('pending_delete'),
    v.literal('rejected'),
  ),
  register: v.optional(
    v.union(v.literal('first_person'), v.literal('narrative_fiction')),
  ),
  createdAt: v.number(),
  dataPurgeAfter: v.optional(v.number()),
})
  .index('pseudonym', ['pseudonym'])
  .index('state', ['state']);
