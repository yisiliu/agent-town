import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';
import { lookupCachedResponse } from '../lib/idempotency';

// Internal-only — called by the llmRouter action via ctx.runQuery. Not
// exposed to the client; the chokepoint surface is the action itself.
export default internalQuery({
  args: {
    agentId: v.string(),
    idempotencyKey: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { agentId, idempotencyKey, now }) => {
    return lookupCachedResponse(ctx, agentId, idempotencyKey, now);
  },
});
