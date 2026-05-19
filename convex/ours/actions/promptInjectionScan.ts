import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { internal } from '../../_generated/api';
import {
  scanForPromptInjection,
  INJECTION_CLASSIFIER_SYSTEM,
} from '../lib/promptInjectionScanCore';
import { callLlamaGuard } from '../lib/togetherClient';

// Spec §4.9 prompt-injection gate, two layers:
//   1. Llama Guard 4 via Together (harmful content).
//   2. DeepSeek-prompted classifier through llmRouter (injection
//      detection — Llama Guard's taxonomy doesn't cover this).
// Either layer's block decision is final. Both fail-closed on error.
// Together is outside the §5.1 chokepoint by design; the DeepSeek
// hop in layer 2 goes through llmRouter so the chokepoint is honored.
export default action({
  args: {
    text: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ref = internal as any;
    return scanForPromptInjection(
      {
        classify: callLlamaGuard,
        classifyInjection: async ({ text, idempotencyKey }) => {
          // Wrap the untrusted input in explicit delimiters so the
          // classifier can distinguish its instructions from the
          // content being classified. The system prompt tells the
          // model to treat everything between the tags as data.
          const wrapped = `<UNTRUSTED_TEXT>\n${text}\n</UNTRUSTED_TEXT>`;
          const result = await ctx.runAction(
            ref.ours.actions.llmRouter.default,
            {
              callType: 'injection_scan',
              agentId: 'injection-scanner',
              systemPrompt: INJECTION_CLASSIFIER_SYSTEM,
              userMessages: [{ role: 'user', content: wrapped }],
              idempotencyKey,
            },
          );
          return result.responseText as string;
        },
      },
      args,
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
  },
});
