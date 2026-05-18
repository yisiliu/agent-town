import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { internal } from '../../_generated/api';
import {
  scanForPII,
  PII_CLASSIFIER_SYSTEM,
  type LLMSeverity,
} from '../lib/piiScanCore';

// Spec §4.9 PII gate. The classifier path routes through llmRouter
// (callType `pii_scan`, 200-token cap already wired) so the §5.1
// chokepoint owns every Anthropic call. Caller-side (uploadTwin in
// Task 10) supplies an idempotencyKey that the router uses to
// dedupe re-tries; we use a fixed `pii-scanner` agentId since the
// caller's key is already unique per (twin, content-hash).
export default action({
  args: {
    text: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ref = internal as any;
    return scanForPII(
      {
        classifyWithLLM: async ({ text, idempotencyKey }) => {
          const result = await ctx.runAction(ref.ours.actions.llmRouter.default, {
            callType: 'pii_scan',
            agentId: 'pii-scanner',
            systemPrompt: PII_CLASSIFIER_SYSTEM,
            userMessages: [{ role: 'user', content: text }],
            idempotencyKey,
          });
          return result.responseText as LLMSeverity;
        },
      },
      args,
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
  },
});
