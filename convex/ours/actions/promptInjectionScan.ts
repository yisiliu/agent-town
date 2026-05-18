import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { scanForPromptInjection } from '../lib/promptInjectionScanCore';
import { callLlamaGuard } from '../lib/togetherClient';

// Spec §4.9 prompt-injection gate. Llama Guard 3 via Together API; we
// fail-closed on classifier error (block + reason) per the spec's
// "classifier failure blocks pending instructor review". Together is
// outside the §5.1 Anthropic chokepoint by design — Llama Guard is a
// moderation classifier, not a frontier inference call, and is single-
// ingressed through ours/lib/togetherClient.
export default action({
  args: {
    text: v.string(),
  },
  handler: async (_ctx, args) => {
    return scanForPromptInjection(
      { classify: callLlamaGuard },
      args,
    );
  },
});
