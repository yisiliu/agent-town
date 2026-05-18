import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { routeLLMCall } from '../lib/llmRouterCore';
import { callAnthropicAPI } from '../lib/anthropicClient';

// Spec §5.1 single chokepoint. Every LLM call in the system routes
// through this action — scripts/check-no-bare-llm-calls.sh fails CI if
// any file outside ours/lib/anthropicClient.ts imports the SDK.
//
// The action is a thin wire from ActionCtx to the pure routeLLMCall in
// llmRouterCore: idempotency reads/writes go through internal
// query/mutation wrappers (actions don't have direct ctx.db), and
// callAnthropic is the SDK wrapper from ours/lib/anthropicClient.
export default action({
  args: {
    callType: v.union(
      v.literal('conversation_reply'),
      v.literal('game_speech'),
      v.literal('reflection'),
      v.literal('pii_scan'),
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
    // _generated/api stubs are loose (AnyApi) until `convex codegen` runs
    // against a real deployment — chained access lands on the real
    // function references at deploy time. Cast through `any` so tsc under
    // noUncheckedIndexedAccess doesn't object to the placeholder shape.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ref = internal as any;
    return routeLLMCall(
      {
        lookupCache: (k) =>
          ctx.runQuery(ref.ours.queries.getCachedLlmCall.default, k),
        writeCache: (k) =>
          ctx.runMutation(ref.ours.mutations.recordLlmCall.default, k),
        callAnthropic: callAnthropicAPI,
      },
      { ...args, now },
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
  },
});
