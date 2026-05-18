// Spec §5.1 — the single chokepoint for all LLM calls. The action wrapper
// in ours/actions/llmRouter wires real deps (Convex db read/write,
// Anthropic SDK call, RunPod fetch, spend tracker); this file is pure
// orchestration so tests don't need network or Convex runtime to
// exercise tier dispatch, idempotency, retry, kill-switch, and token-cap
// behavior.

export type CallType =
  | 'conversation_reply'
  | 'game_speech'
  | 'reflection'
  | 'pii_scan'
  | 'idle_thought'
  | 'move_decision';

// Spec §5.1 tier table. `idle_thought` + `move_decision` are mechanical
// ambient calls — Qwen3-7B on RunPod is plenty for them and the cost
// shape (flat-rate warm replica) suits the high-volume tick cadence.
const LOCAL_CALLTYPES: ReadonlySet<CallType> = new Set([
  'idle_thought',
  'move_decision',
]);

export type Tier = 'frontier' | 'local';

export function tierFor(callType: CallType): Tier {
  return LOCAL_CALLTYPES.has(callType) ? 'local' : 'frontier';
}

// max_tokens caps per spec — keeps per-call spend bounded without
// affecting response quality (these are tail-bound caps, not targets
// the model usually approaches). Local-tier caps are tight because
// idle thoughts / move decisions are mechanical and never read by
// humans at length.
export const OUTPUT_TOKEN_CAPS: Record<CallType, number> = {
  conversation_reply: 200,
  game_speech: 300,
  reflection: 500,
  pii_scan: 200,
  idle_thought: 80,
  move_decision: 40,
};

// Sonnet 4.6 — spec §5.1 frontier tier.
export const FRONTIER_MODEL = 'claude-sonnet-4-6';
// Qwen3-7B served behind a RunPod serverless endpoint. The exact
// endpoint ID is config; this string is what we pass to the RunPod
// client which forwards it as the `model` field.
export const LOCAL_MODEL = 'qwen3-7b';

// 1h idempotency window — matches the persona-cache TTL so cache writes
// and cache reads expire in lockstep.
export const IDEMPOTENCY_TTL_MS = 60 * 60 * 1_000;

// Spec §3.5: hard kill-switch at $0.50/twin/day. Tracked over frontier
// spend only (RunPod is flat-rate; calling it more doesn't bill more).
// The cap applies to ALL future calls once tripped — frontier and local —
// so the twin's "pause" is visible (no idle thoughts either).
export const KILL_SWITCH_DAILY_USD = 0.5;
export const KILL_SWITCH_ERROR_PREFIX = 'KILL_SWITCH_EXCEEDED';

// Sonnet 4.6 list price as of 2026-Q2: $3/M input, $15/M output. Used to
// estimate per-call cost from the Anthropic usage block. We don't bill
// students directly — this number drives the §3.5 runaway-cost cap only.
const FRONTIER_INPUT_USD_PER_TOKEN = 3 / 1_000_000;
const FRONTIER_OUTPUT_USD_PER_TOKEN = 15 / 1_000_000;

export function estimateFrontierCostUsd(usage: {
  input_tokens: number;
  output_tokens: number;
}): number {
  return (
    usage.input_tokens * FRONTIER_INPUT_USD_PER_TOKEN +
    usage.output_tokens * FRONTIER_OUTPUT_USD_PER_TOKEN
  );
}

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
  tier: Tier;
  usage?: { inputTokens: number; outputTokens: number };
  // True when a local-tier 5xx triggered the spec §3.5 silent-twin
  // fallback. Caller treats this as "twin skips this tick".
  degraded?: boolean;
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

// RunPod uses the same shape as Anthropic for the purposes of this
// router — keeps the dispatch branch trivial. Models differ; cost
// envelopes differ; but the I/O contract is intentionally identical.
export type RunpodCallArgs = AnthropicCallArgs;
export type RunpodCallResult = AnthropicCallResult;

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
    tier: Tier;
    now: number;
  }) => Promise<void>;
  callAnthropic: (req: AnthropicCallArgs) => Promise<AnthropicCallResult>;
  callRunpod: (req: RunpodCallArgs) => Promise<RunpodCallResult>;
  // Returns the agent's accumulated USD spend for today (UTC date
  // bucket). 0 when the agent has no row for today.
  lookupDailySpendUsd: (args: {
    agentId: string;
    now: number;
  }) => Promise<number>;
  // Bumps the spend bucket by `costUsd`. Called only on successful
  // frontier API completions (never on cache hits, never for local
  // tier, never on failed calls).
  addDailySpendUsd: (args: {
    agentId: string;
    costUsd: number;
    now: number;
  }) => Promise<void>;
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
  const tier = tierFor(req.callType);

  // §3.5 kill-switch gate. Tripped state pauses everything — local and
  // frontier — so the twin is fully silent until the spend bucket rolls
  // over at the next UTC day boundary.
  const spendToday = await deps.lookupDailySpendUsd({
    agentId: req.agentId,
    now: req.now,
  });
  if (spendToday >= KILL_SWITCH_DAILY_USD) {
    throw new Error(
      `${KILL_SWITCH_ERROR_PREFIX}: agent ${req.agentId} reached $${spendToday.toFixed(4)}/day (cap $${KILL_SWITCH_DAILY_USD})`,
    );
  }

  const cached = await deps.lookupCache({
    agentId: req.agentId,
    idempotencyKey: req.idempotencyKey,
    now: req.now,
  });
  if (cached) {
    return {
      responseText: cached.response,
      cached: true,
      tier,
    };
  }

  const maxTokens = OUTPUT_TOKEN_CAPS[req.callType];
  const sleep = deps.sleep ?? defaultSleep;
  const model = tier === 'frontier' ? FRONTIER_MODEL : LOCAL_MODEL;

  // Local tier: single attempt + degrade-to-silence on any failure.
  // Spec §3.5 — "RunPod cold start → router emits silence event". We
  // don't retry local calls because the warmup cron is the recovery
  // mechanism, and stalling the tick on retries would back up the
  // whole town.
  if (tier === 'local') {
    try {
      const result = await deps.callRunpod({
        model,
        maxTokens,
        system: req.systemPrompt,
        messages: req.userMessages,
      });
      await deps.writeCache({
        agentId: req.agentId,
        idempotencyKey: req.idempotencyKey,
        callType: req.callType,
        response: result.text,
        tier,
        now: req.now,
      });
      return {
        responseText: result.text,
        cached: false,
        tier,
        usage: {
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
        },
      };
    } catch {
      // Silent-twin fallback. Don't cache empty text — let the next
      // tick re-roll once the pod is warm.
      return {
        responseText: '',
        cached: false,
        tier,
        degraded: true,
      };
    }
  }

  // Frontier tier: retry transient 5xx, fail-fast on 4xx, bill spend on
  // success.
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await deps.callAnthropic({
        model,
        maxTokens,
        system: req.systemPrompt,
        messages: req.userMessages,
      });

      await deps.writeCache({
        agentId: req.agentId,
        idempotencyKey: req.idempotencyKey,
        callType: req.callType,
        response: result.text,
        tier,
        now: req.now,
      });

      await deps.addDailySpendUsd({
        agentId: req.agentId,
        costUsd: estimateFrontierCostUsd(result.usage),
        now: req.now,
      });

      return {
        responseText: result.text,
        cached: false,
        tier,
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
