import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  routeLLMCall,
  OUTPUT_TOKEN_CAPS,
  KILL_SWITCH_DAILY_USD,
  KILL_SWITCH_ERROR_PREFIX,
  tierFor,
  type RouteDeps,
  type RouteRequest,
  type CallType,
} from '../ours/lib/llmRouterCore';

function baseRequest(): RouteRequest {
  return {
    callType: 'idle_thought',
    agentId: 'twin-rose-fox-7',
    systemPrompt: 'You are 灯火. Keep thoughts terse.',
    userMessages: [{ role: 'user', content: 'It is morning.' }],
    idempotencyKey: `tick-${Date.now()}-${Math.random()}`,
    now: 1_700_000_000_000,
  };
}

function makeDeps(overrides: Partial<RouteDeps> = {}): RouteDeps {
  return {
    lookupCache: vi.fn().mockResolvedValue(null),
    writeCache: vi.fn().mockResolvedValue(undefined),
    callAnthropic: vi.fn().mockResolvedValue({
      text: 'frontier text',
      usage: { input_tokens: 50, output_tokens: 8 },
    }),
    callRunpod: vi.fn().mockResolvedValue({
      text: 'a small green thought',
      usage: { input_tokens: 20, output_tokens: 4 },
    }),
    lookupDailySpendUsd: vi.fn().mockResolvedValue(0),
    addDailySpendUsd: vi.fn().mockResolvedValue(undefined),
    sleep: () => Promise.resolve(),
    ...overrides,
  };
}

describe('tierFor — spec §5.1 callType → tier mapping', () => {
  it.each([
    ['idle_thought', 'local'],
    ['move_decision', 'local'],
    ['conversation_reply', 'frontier'],
    ['game_speech', 'frontier'],
    ['reflection', 'frontier'],
    ['pii_scan', 'frontier'],
  ] as const)('routes %s → %s', (callType, expected) => {
    expect(tierFor(callType)).toBe(expected);
    expect(OUTPUT_TOKEN_CAPS[callType as CallType]).toBeGreaterThan(0);
  });
});

describe('routeLLMCall — local tier dispatch', () => {
  it('routes idle_thought to RunPod, not Anthropic', async () => {
    const deps = makeDeps();
    const out = await routeLLMCall(deps, baseRequest());
    expect(out.tier).toBe('local');
    expect(out.responseText).toBe('a small green thought');
    expect(deps.callRunpod).toHaveBeenCalledTimes(1);
    expect(deps.callAnthropic).not.toHaveBeenCalled();
  });

  it('writes the cache with tier="local" for local calls', async () => {
    const deps = makeDeps();
    await routeLLMCall(deps, baseRequest());
    expect(deps.writeCache).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'local' }),
    );
  });

  it('frontier callTypes still route to Anthropic, not RunPod', async () => {
    const deps = makeDeps();
    await routeLLMCall(deps, { ...baseRequest(), callType: 'conversation_reply' });
    expect(deps.callAnthropic).toHaveBeenCalledTimes(1);
    expect(deps.callRunpod).not.toHaveBeenCalled();
  });
});

describe('routeLLMCall — RunPod 5xx fallback (spec §3.5 degradation)', () => {
  it('returns a degraded empty response when RunPod 5xx — twin says nothing this tick', async () => {
    const callRunpod = vi
      .fn()
      .mockRejectedValue(new Error('RunPod 503: pod cold'));
    const deps = makeDeps({ callRunpod });
    const out = await routeLLMCall(deps, baseRequest());
    expect(out.responseText).toBe('');
    expect(out.degraded).toBe(true);
    expect(out.tier).toBe('local');
    // Don't cache the degraded fallback — next tick should re-try.
    expect(deps.writeCache).not.toHaveBeenCalled();
  });

  it('does NOT degrade-fallback for frontier 5xx — keeps retry-then-throw', async () => {
    const callAnthropic = vi
      .fn()
      .mockRejectedValue(new Error('Anthropic 500: server'));
    const deps = makeDeps({ callAnthropic });
    await expect(
      routeLLMCall(deps, { ...baseRequest(), callType: 'conversation_reply' }),
    ).rejects.toThrow(/Anthropic 500/);
  });
});

describe('routeLLMCall — per-agent kill-switch (spec §3.5 cost cap)', () => {
  it('exposes the documented daily cap', () => {
    expect(KILL_SWITCH_DAILY_USD).toBe(0.5);
  });

  it('throws KILL_SWITCH error pre-call when daily spend already exceeds cap', async () => {
    const deps = makeDeps({
      lookupDailySpendUsd: vi.fn().mockResolvedValue(0.51),
    });
    await expect(routeLLMCall(deps, baseRequest())).rejects.toThrow(
      new RegExp(KILL_SWITCH_ERROR_PREFIX),
    );
    expect(deps.callRunpod).not.toHaveBeenCalled();
    expect(deps.callAnthropic).not.toHaveBeenCalled();
  });

  it('kill-switch applies to frontier calls too (twin is fully paused)', async () => {
    const deps = makeDeps({
      lookupDailySpendUsd: vi.fn().mockResolvedValue(0.6),
    });
    await expect(
      routeLLMCall(deps, { ...baseRequest(), callType: 'conversation_reply' }),
    ).rejects.toThrow(new RegExp(KILL_SWITCH_ERROR_PREFIX));
  });

  it('allows the call when spend is below cap and increments after frontier success', async () => {
    const deps = makeDeps({
      lookupDailySpendUsd: vi.fn().mockResolvedValue(0.1),
    });
    const out = await routeLLMCall(deps, {
      ...baseRequest(),
      callType: 'conversation_reply',
    });
    expect(out.responseText).toBe('frontier text');
    expect(deps.addDailySpendUsd).toHaveBeenCalledTimes(1);
    const call = (deps.addDailySpendUsd as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(call).toBeDefined();
    const args = call![0];
    expect(args.agentId).toBe('twin-rose-fox-7');
    expect(args.costUsd).toBeGreaterThan(0);
  });

  it('does NOT increment spend for local-tier calls (RunPod is flat-rate)', async () => {
    const deps = makeDeps();
    await routeLLMCall(deps, baseRequest());
    expect(deps.addDailySpendUsd).not.toHaveBeenCalled();
  });

  it('does NOT increment spend on a degraded fallback (failed call shouldn\'t bill)', async () => {
    const deps = makeDeps({
      callAnthropic: vi
        .fn()
        .mockRejectedValue(new Error('Anthropic 500')),
    });
    // Frontier 5xx throws — spend stays at zero.
    await expect(
      routeLLMCall(deps, { ...baseRequest(), callType: 'conversation_reply' }),
    ).rejects.toThrow();
    expect(deps.addDailySpendUsd).not.toHaveBeenCalled();
  });

  it('does NOT count cache hits toward spend (no fresh API spend on hit)', async () => {
    const deps = makeDeps({
      lookupCache: vi.fn().mockResolvedValue({ response: 'cached' }),
    });
    await routeLLMCall(deps, { ...baseRequest(), callType: 'conversation_reply' });
    expect(deps.addDailySpendUsd).not.toHaveBeenCalled();
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});
