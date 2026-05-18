import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const llmCallIdempotency = defineTable({
  agentId: v.string(),
  idempotencyKey: v.string(),
  callType: v.string(),
  response: v.string(),
  tier: v.union(v.literal('frontier'), v.literal('local')),
  cachedAt: v.number(),
  expiresAt: v.number(),
})
  .index('agent_key', ['agentId', 'idempotencyKey'])
  .index('expiresAt', ['expiresAt']);
