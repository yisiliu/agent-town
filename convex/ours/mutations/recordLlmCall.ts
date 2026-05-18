import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { persistCachedResponse } from '../lib/idempotency';

// Internal-only — called by the llmRouter action after a successful
// Anthropic call. Replaces any prior row for the (agentId, key) tuple,
// so a duplicate post is idempotent at the storage layer too.
export default internalMutation({
  args: {
    agentId: v.string(),
    idempotencyKey: v.string(),
    callType: v.string(),
    response: v.string(),
    tier: v.union(v.literal('frontier'), v.literal('local')),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await persistCachedResponse(ctx, args);
  },
});
