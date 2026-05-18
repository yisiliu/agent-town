import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const consents = defineTable({
  twinId: v.id('twins'),
  consentType: v.union(
    v.literal('irb'),
    v.literal('dpia'),
    v.literal('data_use'),
    v.literal('publication'),
  ),
  version: v.string(),
  signedAt: v.number(),
  signedFormStorageId: v.optional(v.string()),
})
  .index('twinId', ['twinId'])
  .index('twin_type', ['twinId', 'consentType']);
