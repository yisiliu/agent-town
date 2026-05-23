// Spec §5.1 — the single chokepoint for all LLM calls. The action
// wrapper in ours/actions/llmRouter wires real deps (Convex db
// read/write, DeepSeek API call, spend tracker); this file is pure
// orchestration so tests don't need network or Convex runtime to
// exercise tier dispatch, idempotency, retry, kill-switch, and
// token-cap behavior.
//
// Provider history: spec v1 was Anthropic Sonnet 4.6 (frontier) +
// Qwen3-7B on RunPod (local). Swapped to DeepSeek V4 Pro + V4 Flash
// for cost + Chinese benchmark performance + single-provider
// simplification. The `callFrontier` / `callLocal` dep names are
// provider-agnostic so future swaps don't need this rewrite.

export type CallType =
  | 'conversation_reply'
  | 'game_speech'
  | 'reflection'
  | 'pii_scan'
  | 'injection_scan'
  | 'private_chat'
  | 'interaction_turn'
  | 'idle_thought'
  | 'move_decision';

// `idle_thought` + `move_decision` are mechanical ambient calls — V4
// Flash is plenty. `private_chat` + `interaction_turn` were originally
// on frontier per spec §5.1, but the 2026-05 audit showed they accounted
// for ~79% of pro spend with no perceptible quality drop on flash; moved
// to local to cut ~48% of daily LLM cost. `pii_scan` + `injection_scan`
// stay on frontier — they're the upload gate, run once per twin, and
// false-negatives matter more than the marginal cost.
const LOCAL_CALLTYPES: ReadonlySet<CallType> = new Set([
  'idle_thought',
  'move_decision',
  'private_chat',
  'interaction_turn',
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
  // Classifier callTypes: ask for one word (HIGH/MEDIUM/NONE) but
  // DeepSeek V4 Pro defaults to reasoning mode, burning tokens on
  // chain-of-thought before emitting `content`. A tight cap leaves
  // an empty `content` field. 1024 gives reasoning room while keeping
  // billing trivial — single-word answers cost the same regardless of
  // the cap, only the (rare) verbose response hits it.
  pii_scan: 1024,
  injection_scan: 1024,
  // Private 1-on-1 chat with own twin (not the in-town conversation
  // path — that's conversation_reply with its 200-token civic cap).
  // 1200 leaves reasoning room + room for a real-length reply.
  private_chat: 1200,
  // Multi-party game turn (werewolf, future plugins). JSON envelope with
  // thinking + say + structured action — plus V4 Pro's chain-of-thought
  // before emitting content. First 9p live game (2026-05-19 round 2) at
  // 3000 still showed 30-40% empty-content rate on the first wolf bid,
  // where the model thinks-from-scratch with no prior bid context. Bumped
  // to 4500. deepseekClient also retries once on empty content as a
  // belt-and-braces measure. Worst-case ~$0.016/turn; 9p ~80-turn game
  // ~$1.30 ceiling. (Auto prompt cache hits drop the real cost to ~30%
  // of that.)
  interaction_turn: 4500,
  idle_thought: 80,
  move_decision: 40,
};

// DeepSeek V4 Pro (frontier) tops the BenchLM Chinese leaderboard at 87
// and is materially cheaper than Sonnet/GPT-5.4 for our Chinese-heavy
// cohort. V4 Flash (local) is the same family without thinking-mode
// overhead — right for mechanical ambient calls.
export const FRONTIER_MODEL = 'deepseek-v4-pro';
export const LOCAL_MODEL = 'deepseek-v4-flash';

// 1h idempotency window — matches the persona-cache TTL so cache writes
// and cache reads expire in lockstep.
export const IDEMPOTENCY_TTL_MS = 60 * 60 * 1_000;

// Spec §3.5: hard kill-switch at $0.50/twin/day. Applied symmetrically
// to both tiers — V4 Pro and V4 Flash both bill per-token, so a
// runaway loop on either side accrues real spend. The pre-call gate
// pauses everything once tripped so a paused twin reads as fully
// silent (no eerie idle-thinking while conversation is dead).
export const KILL_SWITCH_DAILY_USD = 0.5;
export const KILL_SWITCH_ERROR_PREFIX = 'KILL_SWITCH_EXCEEDED';

// DeepSeek V4 Pro post-promo list price ($1.74 in / $3.48 out per M
// tokens; promo at 1/4 that ends 2026-05-31). We use the higher
// post-promo number so the kill-switch errs pessimistic during the
// promo window — fires earlier than real spend would warrant, which
// matches the cap's "runaway-loop hard-stop" intent.
const FRONTIER_INPUT_USD_PER_TOKEN = 1.74 / 1_000_000;
const FRONTIER_OUTPUT_USD_PER_TOKEN = 3.48 / 1_000_000;

// V4 Flash list price.
const LOCAL_INPUT_USD_PER_TOKEN = 0.14 / 1_000_000;
const LOCAL_OUTPUT_USD_PER_TOKEN = 0.28 / 1_000_000;

export function estimateFrontierCostUsd(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_hit_tokens?: number;
  cache_miss_tokens?: number;
}): number {
  // Cache-hit tokens bill at 10% of miss rate. Default to "all miss"
  // when fields absent (older callers).
  const hit = usage.cache_hit_tokens ?? 0;
  const miss = usage.cache_miss_tokens ?? Math.max(0, usage.input_tokens - hit);
  return (
    miss * FRONTIER_INPUT_USD_PER_TOKEN +
    hit * FRONTIER_INPUT_USD_PER_TOKEN * 0.1 +
    usage.output_tokens * FRONTIER_OUTPUT_USD_PER_TOKEN
  );
}

export function estimateLocalCostUsd(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_hit_tokens?: number;
  cache_miss_tokens?: number;
}): number {
  const hit = usage.cache_hit_tokens ?? 0;
  const miss = usage.cache_miss_tokens ?? Math.max(0, usage.input_tokens - hit);
  return (
    miss * LOCAL_INPUT_USD_PER_TOKEN +
    hit * LOCAL_INPUT_USD_PER_TOKEN * 0.1 +
    usage.output_tokens * LOCAL_OUTPUT_USD_PER_TOKEN
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
  // True when a local-tier failure triggered the spec §3.5 silent-
  // twin fallback. Caller treats this as "twin skips this tick".
  degraded?: boolean;
}

// Provider-agnostic call contract. The action wrapper wires both
// callFrontier and callLocal to the same callDeepseekAPI today; future
// per-tier provider splits don't require touching the core.
export interface LLMCallArgs {
  model: string;
  maxTokens: number;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface LLMCallResult {
  text: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_hit_tokens?: number;
    cache_miss_tokens?: number;
  };
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
    tier: Tier;
    now: number;
  }) => Promise<void>;
  callFrontier: (req: LLMCallArgs) => Promise<LLMCallResult>;
  callLocal: (req: LLMCallArgs) => Promise<LLMCallResult>;
  // Returns the agent's accumulated USD spend for today (UTC date
  // bucket). 0 when the agent has no row for today.
  lookupDailySpendUsd: (args: {
    agentId: string;
    now: number;
  }) => Promise<number>;
  // Bumps the spend bucket. Called on successful API completions on
  // both tiers; not called on cache hits or failed calls.
  addDailySpendUsd: (args: {
    agentId: string;
    costUsd: number;
    now: number;
  }) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

// Heuristic: provider clients throw errors whose message includes the
// HTTP status. 4xx is caller-side (don't retry); 5xx and 529 are
// transient (retry up to MAX_RETRIES with backoff). The deepseekClient
// preserves status info in the error message so this stays
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

  // §3.5 kill-switch gate. Tripped state pauses everything — local
  // and frontier — so the twin is fully silent until the spend bucket
  // rolls over at the next UTC day boundary.
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
  // Spec §3.5 — stalling the tick on retries would back up the whole
  // town; the silent-twin fallback is the recovery mechanism, and
  // DeepSeek is hosted-and-warm so cold-start retries don't apply.
  if (tier === 'local') {
    try {
      const result = await deps.callLocal({
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
        costUsd: estimateLocalCostUsd(result.usage),
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
      // tick re-roll. Don't bill spend either (failed calls don't
      // accrue cost).
      return {
        responseText: '',
        cached: false,
        tier,
        degraded: true,
      };
    }
  }

  // Frontier tier: retry transient 5xx, fail-fast on 4xx, bill spend
  // on success.
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await deps.callFrontier({
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
