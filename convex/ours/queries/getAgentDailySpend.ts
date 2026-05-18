import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';
import { getDailySpendUsd } from '../lib/spendTracking';

// Internal — called by the llmRouter action via ctx.runQuery to check
// the spec §3.5 kill-switch before each LLM call.
export default internalQuery({
  args: {
    agentId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { agentId, now }) => {
    return getDailySpendUsd(ctx, agentId, now);
  },
});
