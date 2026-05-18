import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const crossBorderTransfers = defineTable({
  twinId: v.optional(v.id('twins')),
  sessionFlag: v.string(),
  sourceCountry: v.string(),
  destinationVendor: v.string(),
  callType: v.string(),
  payloadHash: v.string(),
  transferredAt: v.number(),
})
  .index('transferredAt', ['transferredAt'])
  .index('twin', ['twinId', 'transferredAt'])
  .index('vendor', ['destinationVendor', 'transferredAt']);
