import type { LLMCallArgs, LLMCallResult } from './llmRouterCore';

// Single ingress for DeepSeek calls — both tiers route through here.
// V4 Pro for frontier, V4 Flash for local; the model string comes from
// llmRouterCore and is forwarded as the `model` field. DeepSeek speaks
// the OpenAI-compatible /v1/chat/completions protocol, so this is a
// thin fetch wrapper with no SDK.

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';
const TIMEOUT_MS = 30_000;

function apiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('deepseek: DEEPSEEK_API_KEY env var is missing');
  return key;
}

// DeepSeek auto-caches the system-prompt prefix — no explicit
// cache_control annotations needed. Cache hits bill at 1/10 of the
// cache-miss input rate. Caller is responsible for putting the most-
// stable text (persona card) at the start of the system prompt for
// prefix-cache to actually hit.
export async function callDeepseekAPI(
  req: LLMCallArgs,
): Promise<LLMCallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        messages: [
          { role: 'system', content: req.system },
          ...req.messages,
        ],
      }),
    });
    if (!res.ok) {
      // Preserve HTTP status in the message so routeLLMCall's
      // 5xx-vs-4xx retry heuristic stays dependency-free.
      const body = await res.text();
      throw new Error(
        `deepseek ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    return parseDeepseekReply(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

interface DeepseekResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

// Exported for unit tests — the OpenAI-shaped reply parser is the
// most drift-prone boundary (rev-to-rev DeepSeek changes have been
// minor but worth a fence).
export function parseDeepseekReply(raw: unknown): LLMCallResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error('deepseek: empty reply');
  }
  const json = raw as DeepseekResponse;
  const text = json.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new Error('deepseek: missing choices[0].message.content');
  }
  return {
    text,
    usage: {
      input_tokens: json.usage?.prompt_tokens ?? 0,
      output_tokens: json.usage?.completion_tokens ?? 0,
    },
  };
}
