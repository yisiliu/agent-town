import Anthropic from '@anthropic-ai/sdk';
import type { AnthropicCallArgs, AnthropicCallResult } from './llmRouterCore';

// The only place in the codebase that imports @anthropic-ai/sdk — enforced
// by scripts/check-no-bare-llm-calls.sh. All callers route through
// ours/actions/llmRouter → routeLLMCall → callAnthropicAPI here.

// Lazily-constructed: Convex actions run in a V8 isolate where the SDK
// loads on first use. Reusing one client across calls amortizes any
// internal warm-up.
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (client === null) client = new Anthropic();
  return client;
}

// 1h ephemeral cache on the persona prompt. The system block is what
// changes least across calls for a given twin — caching it under one
// breakpoint covers every conversation turn / game speech / reflection
// for that twin within the hour.
export async function callAnthropicAPI(
  req: AnthropicCallArgs,
): Promise<AnthropicCallResult> {
  try {
    const response = await getClient().messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      system: [
        {
          type: 'text',
          text: req.system,
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
      ],
      messages: req.messages,
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return {
      text,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  } catch (err) {
    // Preserve HTTP status in the message so routeLLMCall's retry heuristic
    // can distinguish transient 5xx from caller-side 4xx without depending
    // on the SDK exception class hierarchy.
    if (err instanceof Anthropic.APIError) {
      throw new Error(
        `Anthropic ${err.status ?? 'unknown'}: ${err.message}`,
        { cause: err },
      );
    }
    throw err;
  }
}
