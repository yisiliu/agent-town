// Spec §5.1 — the single chokepoint for all LLM calls. The action wrapper
// in ours/actions/llmRouter wires real deps (Convex db read/write,
// Anthropic SDK call); this file is pure orchestration so tests don't
// need network or Convex runtime to exercise idempotency, retry, and
// token-cap behavior.

export type CallType =
  | 'conversation_reply'
  | 'game_speech'
  | 'reflection'
  | 'pii_scan';

// max_tokens caps per spec — keeps frontier-tier spend per agent bounded
// without affecting response quality (these are tail-bound caps, not
// targets the model usually approaches).
export const OUTPUT_TOKEN_CAPS: Record<CallType, number> = {
  conversation_reply: 200,
  game_speech: 300,
  reflection: 500,
  pii_scan: 200,
};

// Sonnet 4.6 — spec §5.1 frontier tier.
export const FRONTIER_MODEL = 'claude-sonnet-4-6';

// 1h idempotency window — matches the persona-cache TTL so cache writes
// and cache reads expire in lockstep.
export const IDEMPOTENCY_TTL_MS = 60 * 60 * 1_000;

const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [500, 1_500] as const;

export interface RouteRequest {
  callType: CallType;
  agentId: string;
  systemPrompt: string;
  userMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  idempotencyKey: string;
  now: number;
}

export interface RouteResponse {
  responseText: string;
  cached: boolean;
  tier: 'frontier' | 'local';
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AnthropicCallArgs {
  model: string;
  maxTokens: number;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface AnthropicCallResult {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
}

export interface RouteDeps {
  lookupCache: (args: {
    agentId: string;
    idempotencyKey: string;
    now: number;
  }) => Promise<{ response: string } | null>;
  writeCache: (args: {
    agentId: string;
    idempotencyKey: string;
    callType: string;
    response: string;
    tier: 'frontier' | 'local';
    now: number;
  }) => Promise<void>;
  callAnthropic: (req: AnthropicCallArgs) => Promise<AnthropicCallResult>;
  sleep?: (ms: number) => Promise<void>;
}

// Heuristic: Anthropic SDK throws errors whose message includes the HTTP
// status. 4xx is caller-side (don't retry); 5xx and 529 are transient
// (retry up to MAX_RETRIES with backoff). The action wrapper around
// callAnthropic preserves status info in the error message so this stays
// dependency-free.
function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /\b(5\d{2}|529)\b/.test(err.message);
}

export async function routeLLMCall(
  deps: RouteDeps,
  req: RouteRequest,
): Promise<RouteResponse> {
  const cached = await deps.lookupCache({
    agentId: req.agentId,
    idempotencyKey: req.idempotencyKey,
    now: req.now,
  });
  if (cached) {
    return {
      responseText: cached.response,
      cached: true,
      tier: 'frontier',
    };
  }

  const maxTokens = OUTPUT_TOKEN_CAPS[req.callType];
  const sleep = deps.sleep ?? defaultSleep;

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await deps.callAnthropic({
        model: FRONTIER_MODEL,
        maxTokens,
        system: req.systemPrompt,
        messages: req.userMessages,
      });

      await deps.writeCache({
        agentId: req.agentId,
        idempotencyKey: req.idempotencyKey,
        callType: req.callType,
        response: result.text,
        tier: 'frontier',
        now: req.now,
      });

      return {
        responseText: result.text,
        cached: false,
        tier: 'frontier',
        usage: {
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
        },
      };
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) throw err;
      const backoff = RETRY_BACKOFF_MS[attempt];
      if (backoff !== undefined) await sleep(backoff);
    }
  }
  throw lastErr ?? new Error('llmRouter: exhausted retries with no error');
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
