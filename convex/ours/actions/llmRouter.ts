import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { routeLLMCall } from '../lib/llmRouterCore';
import { callDeepseekAPI } from '../lib/deepseekClient';

// Spec §5.1 single chokepoint. Every LLM call in the system routes
// through this action — scripts/check-no-bare-llm-calls.sh fails CI
// if any file outside ours/lib/deepseekClient.ts hits the DeepSeek
// API directly.
//
// Both tiers go through callDeepseekAPI; llmRouterCore picks the
// model (V4 Pro vs V4 Flash). The deps interface is provider-
// agnostic so a future per-tier provider split won't change this
// file.
export default action({
  args: {
    callType: v.union(
      v.literal('conversation_reply'),
      v.literal('game_speech'),
      v.literal('reflection'),
      v.literal('pii_scan'),
      v.literal('injection_scan'),
      v.literal('private_chat'),
      v.literal('interaction_turn'),
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
        callFrontier: callDeepseekAPI,
        callLocal: callDeepseekAPI,
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
