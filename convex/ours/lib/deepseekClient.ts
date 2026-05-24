import type { LLMCallArgs, LLMCallResult } from './llmRouterCore';

// Single ingress for DeepSeek calls — both tiers route through here.
// V4 Pro for frontier, V4 Flash for local; the model string comes from
// llmRouterCore and is forwarded as the `model` field. DeepSeek speaks
// the OpenAI-compatible /v1/chat/completions protocol, so this is a
// thin fetch wrapper with no SDK.

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';
// 60s per attempt — V4 Pro reasoning mode + larger max_tokens (now up to
// 4500 for interaction_turn) can take >30s end-to-end, especially under
// parallel load. 30s was too aggressive: persona-gen batch calls of 9
// timed out on the empty-content retry path.
const TIMEOUT_MS = 60_000;
// V4 Pro burns reasoning tokens before emitting content; even at a generous
// max_tokens cap, the model occasionally cuts off mid-CoT and returns empty
// content. Round-2 9p game (2026-05-19) still showed ~40% empty rate on
// day-speak prompts (large transcript + V4 Pro reasoning).
//
// Strategy: 2 retries. The second retry falls back to V4 Flash (no reasoning
// mode → no CoT token burn → always emits content). V4 Flash is lower quality
// but reliable. This bounds the empty-content failure mode at <1% practical
// (would require V4 Pro to fail twice AND V4 Flash to also produce empty).
const EMPTY_CONTENT_RETRIES = 2;
const FRONTIER_MODEL = 'deepseek-v4-pro';
const LOCAL_MODEL = 'deepseek-v4-flash';

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
  let lastResult: LLMCallResult | undefined;
  for (let attempt = 0; attempt <= EMPTY_CONTENT_RETRIES; attempt++) {
    // Attempt 0: original model. Attempt 1: original model (same retry).
    // Attempt 2: if V4 Pro was the original, fall back to V4 Flash.
    // V4 Flash has no reasoning mode so it always emits content directly.
    const effectiveModel =
      attempt >= 2 && req.model === FRONTIER_MODEL ? LOCAL_MODEL : req.model;
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
          model: effectiveModel,
          max_tokens: req.maxTokens,
          messages: [
            { role: 'system', content: req.system },
            ...req.messages,
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`deepseek ${res.status}: ${body.slice(0, 200)}`);
      }
      lastResult = parseDeepseekReply(await res.json());
      if (lastResult.text.trim().length > 0) return lastResult;
    } finally {
      clearTimeout(timer);
    }
  }
  return lastResult ?? { text: '', usage: { input_tokens: 0, output_tokens: 0 } };
}

// Account balance / billing endpoint — not an LLM call, but kept here so
// all access to api.deepseek.com originates from this one client (spec
// §5.1 chokepoint). Used by the one-off spend audit.
export async function fetchDeepseekBalance(): Promise<unknown> {
  const res = await fetch('https://api.deepseek.com/user/balance', {
    method: 'GET',
    headers: {
      authorization: `Bearer ${apiKey()}`,
      'content-type': 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`deepseek balance ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

interface DeepseekResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    // DeepSeek-specific: tokens served from the prompt-prefix cache
    // (10× cheaper than miss). Split should equal prompt_tokens.
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
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
  const promptTokens = json.usage?.prompt_tokens ?? 0;
  const hit = json.usage?.prompt_cache_hit_tokens ?? 0;
  // DeepSeek reports `prompt_cache_miss_tokens` separately; default to
  // `prompt_tokens - hit` when the field is missing.
  const miss = json.usage?.prompt_cache_miss_tokens ?? Math.max(0, promptTokens - hit);
  return {
    text,
    usage: {
      input_tokens: promptTokens,
      output_tokens: json.usage?.completion_tokens ?? 0,
      cache_hit_tokens: hit,
      cache_miss_tokens: miss,
    },
  };
}
