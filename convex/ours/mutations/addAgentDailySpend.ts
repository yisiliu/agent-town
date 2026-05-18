import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { addDailySpendUsd } from '../lib/spendTracking';

// Internal — bumps the agent's UTC-day spend bucket. Called by the
// llmRouter action after each successful frontier completion. Never
// called for local-tier (RunPod is flat-rate), cache hits, or failed
// API calls.
export default internalMutation({
  args: {
    agentId: v.string(),
    costUsd: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await addDailySpendUsd(ctx, args);
  },
});
