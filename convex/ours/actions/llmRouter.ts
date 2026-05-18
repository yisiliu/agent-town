import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { routeLLMCall } from '../lib/llmRouterCore';
import { callAnthropicAPI } from '../lib/anthropicClient';
import { callRunpodAPI } from '../lib/runpodClient';

// Spec §5.1 single chokepoint. Every LLM call in the system routes
// through this action — scripts/check-no-bare-llm-calls.sh fails CI if
// any file outside ours/lib/anthropicClient.ts imports the SDK.
//
// The action is a thin wire from ActionCtx to the pure routeLLMCall in
// llmRouterCore: idempotency reads/writes, kill-switch spend
// lookup/increment, and Anthropic/RunPod calls all flow as deps. The
// internal-only query/mutation wrappers bridge the ctx.db gap (actions
// have no direct db access).
export default action({
  args: {
    callType: v.union(
      v.literal('conversation_reply'),
      v.literal('game_speech'),
      v.literal('reflection'),
      v.literal('pii_scan'),
      v.literal('idle_thought'),
      v.literal('move_decision'),
    ),
    agentId: v.string(),
    systemPrompt: v.string(),
    userMessages: v.array(
      v.object({
        role: v.union(v.literal('user'), v.literal('assistant')),
        content: v.string(),
      }),
    ),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ref = internal as any;
    return routeLLMCall(
      {
        lookupCache: (k) =>
          ctx.runQuery(ref.ours.queries.getCachedLlmCall.default, k),
        writeCache: (k) =>
          ctx.runMutation(ref.ours.mutations.recordLlmCall.default, k),
        callAnthropic: callAnthropicAPI,
        callRunpod: callRunpodAPI,
        lookupDailySpendUsd: (k) =>
          ctx.runQuery(ref.ours.queries.getAgentDailySpend.default, k),
        addDailySpendUsd: (k) =>
          ctx.runMutation(ref.ours.mutations.addAgentDailySpend.default, k),
      },
      { ...args, now },
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
  },
});
