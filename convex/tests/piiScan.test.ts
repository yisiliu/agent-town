import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  scanForPII,
  type PIIScanDeps,
  type LLMSeverity,
} from '../ours/lib/piiScanCore';

function makeDeps(overrides: Partial<PIIScanDeps> = {}): PIIScanDeps {
  return {
    classifyWithLLM: vi
      .fn<PIIScanDeps['classifyWithLLM']>()
      .mockResolvedValue('NONE'),
    ...overrides,
  };
}

describe('scanForPII — regex layer (block-by-default)', () => {
  it('blocks on a US email address', async () => {
    const result = await scanForPII(
      makeDeps(),
      {
        text: 'Reach me at jane.doe@example.com when you can.',
        idempotencyKey: 'k-email-en',
      },
    );
    expect(result.decision).toBe('block');
    expect(result.reasons.join(' ')).toMatch(/email/i);
  });

  it('blocks on a Chinese mainland mobile number', async () => {
    const result = await scanForPII(
      makeDeps(),
      { text: '联系电话 13812345678，欢迎咨询。', idempotencyKey: 'k-phone-zh' },
    );
    expect(result.decision).toBe('block');
    expect(result.reasons.join(' ')).toMatch(/phone/i);
  });

  it('blocks on a US phone number with area code formatting', async () => {
    const result = await scanForPII(
      makeDeps(),
      { text: 'call me at (415) 555-2671 tomorrow', idempotencyKey: 'k-phone-en' },
    );
    expect(result.decision).toBe('block');
    expect(result.reasons.join(' ')).toMatch(/phone/i);
  });

  it('blocks on a Chinese street-address pattern (省/市/路/号)', async () => {
    const result = await scanForPII(
      makeDeps(),
      {
        text: '我现在住在北京市朝阳区建国路88号，欢迎来玩。',
        idempotencyKey: 'k-addr-zh',
      },
    );
    expect(result.decision).toBe('block');
    expect(result.reasons.join(' ')).toMatch(/address/i);
  });

  it('does NOT block on a fictional persona with no PII signals', async () => {
    const deps = makeDeps();
    const result = await scanForPII(
      deps,
      {
        text: '灯火 grew up in a small coastal town and likes long walks at dusk.',
        idempotencyKey: 'k-clean',
      },
    );
    expect(result.decision).toBe('pass');
    expect(deps.classifyWithLLM).toHaveBeenCalledTimes(1);
  });

  it('short-circuits the LLM when regex already blocks (cost optimization)', async () => {
    const deps = makeDeps();
    await scanForPII(
      deps,
      { text: 'email: alice@example.org', idempotencyKey: 'k-shortcircuit' },
    );
    expect(deps.classifyWithLLM).not.toHaveBeenCalled();
  });
});

describe('scanForPII — LLM classifier layer', () => {
  it('blocks when classifier returns HIGH severity', async () => {
    const deps = makeDeps({
      classifyWithLLM: vi.fn<PIIScanDeps['classifyWithLLM']>().mockResolvedValue(
        'HIGH',
      ),
    });
    const result = await scanForPII(
      deps,
      { text: '灯火 is a thoughtful introvert.', idempotencyKey: 'k-llm-high' },
    );
    expect(result.decision).toBe('block');
    expect(result.reasons.join(' ')).toMatch(/classif/i);
  });

  it('flags for manual_review when classifier returns MEDIUM severity', async () => {
    const deps = makeDeps({
      classifyWithLLM: vi.fn<PIIScanDeps['classifyWithLLM']>().mockResolvedValue(
        'MEDIUM',
      ),
    });
    const result = await scanForPII(
      deps,
      { text: 'works at a coffee shop near the park', idempotencyKey: 'k-llm-med' },
    );
    expect(result.decision).toBe('manual_review');
  });

  it('passes when classifier returns NONE severity', async () => {
    const deps = makeDeps({
      classifyWithLLM: vi.fn<PIIScanDeps['classifyWithLLM']>().mockResolvedValue(
        'NONE',
      ),
    });
    const result = await scanForPII(
      deps,
      { text: 'enjoys quiet mornings', idempotencyKey: 'k-llm-none' },
    );
    expect(result.decision).toBe('pass');
    expect(result.reasons).toEqual([]);
  });

  it('flags for manual_review when classifier throws (infra failure, not student fault)', async () => {
    const deps = makeDeps({
      classifyWithLLM: vi
        .fn<PIIScanDeps['classifyWithLLM']>()
        .mockRejectedValue(new Error('llmRouter 500')),
    });
    const result = await scanForPII(
      deps,
      { text: 'quiet mornings, long walks', idempotencyKey: 'k-llm-err' },
    );
    expect(result.decision).toBe('manual_review');
    expect(result.reasons.join(' ')).toMatch(/classifier/i);
  });

  it('flags for manual_review when classifier response is unparseable', async () => {
    const deps = makeDeps({
      classifyWithLLM: vi
        .fn<PIIScanDeps['classifyWithLLM']>()
        // Cast: this test deliberately exercises the parse-failure path.
        .mockResolvedValue('uhhh I dunno' as unknown as LLMSeverity),
    });
    const result = await scanForPII(
      deps,
      { text: 'enjoys quiet mornings', idempotencyKey: 'k-llm-unparse' },
    );
    expect(result.decision).toBe('manual_review');
  });

  it('passes the idempotencyKey through to the classifier dep', async () => {
    const deps = makeDeps();
    await scanForPII(
      deps,
      { text: 'a thoughtful introvert', idempotencyKey: 'k-pass-through' },
    );
    expect(deps.classifyWithLLM).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'k-pass-through' }),
    );
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});
