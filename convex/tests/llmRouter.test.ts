import { describe, it, expect, vi, beforeEach } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../schema';
import {
  routeLLMCall,
  OUTPUT_TOKEN_CAPS,
  FRONTIER_MODEL,
  IDEMPOTENCY_TTL_MS,
  type RouteDeps,
  type RouteRequest,
} from '../ours/lib/llmRouterCore';
import {
  lookupCachedResponse,
  persistCachedResponse,
} from '../ours/lib/idempotency';

const modules = import.meta.glob('../**/*.ts');

function baseRequest(): RouteRequest {
  return {
    callType: 'conversation_reply',
    agentId: 'twin-rose-fox-7',
    systemPrompt: 'You are 灯火. Speak in short clauses.',
    userMessages: [{ role: 'user', content: 'how was the morning?' }],
    idempotencyKey: `tick-${Date.now()}-${Math.random()}`,
    now: 1_700_000_000_000,
  };
}

function makeDeps(overrides: Partial<RouteDeps> = {}): RouteDeps {
  return {
    lookupCache: vi.fn().mockResolvedValue(null),
    writeCache: vi.fn().mockResolvedValue(undefined),
    callAnthropic: vi.fn().mockResolvedValue({
      text: 'a quiet kind of bright',
      usage: { input_tokens: 80, output_tokens: 9 },
    }),
    // Local-tier dep — these tests only exercise frontier callTypes,
    // so RunPod is never called. The mock exists to satisfy the
    // required-dep contract introduced in Task 12.
    callRunpod: vi.fn().mockRejectedValue(
      new Error('callRunpod should not run for frontier tests'),
    ),
    lookupDailySpendUsd: vi.fn().mockResolvedValue(0),
    addDailySpendUsd: vi.fn().mockResolvedValue(undefined),
    sleep: () => Promise.resolve(),
    ...overrides,
  };
}

describe('routeLLMCall — cache behavior', () => {
  it('returns cached response without calling Anthropic on hit', async () => {
    const deps = makeDeps({
      lookupCache: vi
        .fn()
        .mockResolvedValue({ response: 'still soft, like the bay' }),
    });
    const out = await routeLLMCall(deps, baseRequest());
    expect(out.responseText).toBe('still soft, like the bay');
    expect(out.cached).toBe(true);
    expect(deps.callAnthropic).not.toHaveBeenCalled();
    expect(deps.writeCache).not.toHaveBeenCalled();
  });

  it('on cache miss calls Anthropic, writes cache, returns the new response', async () => {
    const deps = makeDeps();
    const req = baseRequest();
    const out = await routeLLMCall(deps, req);
    expect(out.cached).toBe(false);
    expect(out.responseText).toBe('a quiet kind of bright');
    expect(deps.callAnthropic).toHaveBeenCalledTimes(1);
    expect(deps.writeCache).toHaveBeenCalledTimes(1);
    expect(deps.writeCache).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: req.agentId,
        idempotencyKey: req.idempotencyKey,
        response: 'a quiet kind of bright',
        tier: 'frontier',
      }),
    );
  });
});

describe('routeLLMCall — model + token caps', () => {
  it('routes to the frontier model (Sonnet 4.6) for non-ambient callTypes', async () => {
    const deps = makeDeps();
    await routeLLMCall(deps, baseRequest());
    const call = (deps.callAnthropic as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(call.model).toBe(FRONTIER_MODEL);
    expect(FRONTIER_MODEL).toBe('claude-sonnet-4-6');
  });

  it.each([
    ['conversation_reply', 200],
    ['game_speech', 300],
    ['reflection', 500],
    ['pii_scan', 200],
  ] as const)(
    'enforces max_tokens cap of %i for %s',
    async (callType, expected) => {
      const deps = makeDeps();
      await routeLLMCall(deps, { ...baseRequest(), callType });
      const call = (deps.callAnthropic as ReturnType<typeof vi.fn>).mock
        .calls[0]![0];
      expect(call.maxTokens).toBe(expected);
      expect(OUTPUT_TOKEN_CAPS[callType]).toBe(expected);
    },
  );

  it('passes the persona card through as the system prompt', async () => {
    const deps = makeDeps();
    const req = baseRequest();
    await routeLLMCall(deps, req);
    const call = (deps.callAnthropic as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(call.system).toBe(req.systemPrompt);
  });
});

describe('routeLLMCall — retry on 5xx, fail-fast on 4xx', () => {
  it('retries 3x on transient 5xx then succeeds', async () => {
    const callAnthropic = vi
      .fn()
      .mockRejectedValueOnce(new Error('Anthropic 500: server'))
      .mockRejectedValueOnce(new Error('Anthropic 529: overloaded'))
      .mockResolvedValueOnce({
        text: 'finally got through',
        usage: { input_tokens: 10, output_tokens: 4 },
      });
    const deps = makeDeps({ callAnthropic });
    const out = await routeLLMCall(deps, baseRequest());
    expect(out.responseText).toBe('finally got through');
    expect(callAnthropic).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting all retries', async () => {
    const callAnthropic = vi
      .fn()
      .mockRejectedValue(new Error('Anthropic 500: server'));
    const deps = makeDeps({ callAnthropic });
    await expect(routeLLMCall(deps, baseRequest())).rejects.toThrow(
      /Anthropic 500/,
    );
    expect(callAnthropic).toHaveBeenCalledTimes(3);
  });

  it('does not retry on a 4xx (caller error) — fails fast', async () => {
    const callAnthropic = vi
      .fn()
      .mockRejectedValue(new Error('Anthropic 400: bad request'));
    const deps = makeDeps({ callAnthropic });
    await expect(routeLLMCall(deps, baseRequest())).rejects.toThrow(/400/);
    expect(callAnthropic).toHaveBeenCalledTimes(1);
  });

  it('never writes the cache when all retries fail', async () => {
    const callAnthropic = vi
      .fn()
      .mockRejectedValue(new Error('Anthropic 500: server'));
    const deps = makeDeps({ callAnthropic });
    await expect(routeLLMCall(deps, baseRequest())).rejects.toThrow();
    expect(deps.writeCache).not.toHaveBeenCalled();
  });
});

describe('idempotency lib — Convex db integration', () => {
  it('lookupCachedResponse returns null when no row, the stored response when present', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_700_000_000_000;
      expect(
        await lookupCachedResponse(ctx, 'agent-A', 'key-1', t0),
      ).toBeNull();

      await persistCachedResponse(ctx, {
        agentId: 'agent-A',
        idempotencyKey: 'key-1',
        callType: 'conversation_reply',
        response: 'remembered text',
        tier: 'frontier',
        now: t0,
      });

      const found = await lookupCachedResponse(ctx, 'agent-A', 'key-1', t0 + 1);
      expect(found?.response).toBe('remembered text');
    });
  });

  it('lookupCachedResponse returns null past expiry (1h TTL)', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_700_000_000_000;
      await persistCachedResponse(ctx, {
        agentId: 'agent-A',
        idempotencyKey: 'key-1',
        callType: 'conversation_reply',
        response: 'cached',
        tier: 'frontier',
        now: t0,
      });
      const alive = await lookupCachedResponse(
        ctx,
        'agent-A',
        'key-1',
        t0 + IDEMPOTENCY_TTL_MS - 1,
      );
      expect(alive).not.toBeNull();
      const expired = await lookupCachedResponse(
        ctx,
        'agent-A',
        'key-1',
        t0 + IDEMPOTENCY_TTL_MS,
      );
      expect(expired).toBeNull();
    });
  });

  it('persistCachedResponse replaces a prior row with the same (agentId, key)', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_700_000_000_000;
      await persistCachedResponse(ctx, {
        agentId: 'agent-A',
        idempotencyKey: 'key-1',
        callType: 'conversation_reply',
        response: 'first',
        tier: 'frontier',
        now: t0,
      });
      await persistCachedResponse(ctx, {
        agentId: 'agent-A',
        idempotencyKey: 'key-1',
        callType: 'conversation_reply',
        response: 'second',
        tier: 'frontier',
        now: t0 + 1_000,
      });
      const rows = await ctx.db
        .query('llmCallIdempotency')
        .withIndex('agent_key', (q) =>
          q.eq('agentId', 'agent-A').eq('idempotencyKey', 'key-1'),
        )
        .collect();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.response).toBe('second');
    });
  });

  it('different (agentId, key) tuples coexist without collision', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_700_000_000_000;
      await persistCachedResponse(ctx, {
        agentId: 'agent-A',
        idempotencyKey: 'k1',
        callType: 'conversation_reply',
        response: 'A1',
        tier: 'frontier',
        now: t0,
      });
      await persistCachedResponse(ctx, {
        agentId: 'agent-A',
        idempotencyKey: 'k2',
        callType: 'conversation_reply',
        response: 'A2',
        tier: 'frontier',
        now: t0,
      });
      await persistCachedResponse(ctx, {
        agentId: 'agent-B',
        idempotencyKey: 'k1',
        callType: 'conversation_reply',
        response: 'B1',
        tier: 'frontier',
        now: t0,
      });

      const a1 = await lookupCachedResponse(ctx, 'agent-A', 'k1', t0 + 1);
      const a2 = await lookupCachedResponse(ctx, 'agent-A', 'k2', t0 + 1);
      const b1 = await lookupCachedResponse(ctx, 'agent-B', 'k1', t0 + 1);
      expect(a1?.response).toBe('A1');
      expect(a2?.response).toBe('A2');
      expect(b1?.response).toBe('B1');
    });
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});
