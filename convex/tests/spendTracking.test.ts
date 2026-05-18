import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../schema';
import {
  dateUtcBucket,
  getDailySpendUsd,
  addDailySpendUsd,
} from '../ours/lib/spendTracking';
import { estimateFrontierCostUsd } from '../ours/lib/llmRouterCore';

const modules = import.meta.glob('../**/*.ts');

describe('dateUtcBucket', () => {
  it('returns ISO YYYY-MM-DD slice', () => {
    expect(dateUtcBucket(Date.UTC(2026, 4, 18, 23, 59, 59))).toBe(
      '2026-05-18',
    );
  });

  it('rolls over to the next bucket at UTC midnight', () => {
    const justBefore = Date.UTC(2026, 4, 18, 23, 59, 59, 999);
    const justAfter = Date.UTC(2026, 4, 19, 0, 0, 0, 0);
    expect(dateUtcBucket(justBefore)).toBe('2026-05-18');
    expect(dateUtcBucket(justAfter)).toBe('2026-05-19');
  });
});

describe('estimateFrontierCostUsd — Sonnet 4.6 pricing', () => {
  it('charges $3/M input + $15/M output', () => {
    // 1k input + 200 output @ Sonnet 4.6 = $0.003 + $0.003 = $0.006
    const cost = estimateFrontierCostUsd({
      input_tokens: 1_000,
      output_tokens: 200,
    });
    expect(cost).toBeCloseTo(0.006, 6);
  });

  it('handles zero usage as zero cost (defensive)', () => {
    expect(
      estimateFrontierCostUsd({ input_tokens: 0, output_tokens: 0 }),
    ).toBe(0);
  });
});

describe('spendTracking — db integration', () => {
  it('getDailySpendUsd returns 0 when no row exists', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const now = Date.UTC(2026, 4, 18);
      expect(await getDailySpendUsd(ctx, 'twin-A', now)).toBe(0);
    });
  });

  it('addDailySpendUsd creates a row then sums on subsequent adds (same UTC day)', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const now = Date.UTC(2026, 4, 18, 14);
      await addDailySpendUsd(ctx, {
        agentId: 'twin-A',
        costUsd: 0.01,
        now,
      });
      await addDailySpendUsd(ctx, {
        agentId: 'twin-A',
        costUsd: 0.02,
        now: now + 5_000,
      });
      const total = await getDailySpendUsd(ctx, 'twin-A', now + 10_000);
      expect(total).toBeCloseTo(0.03, 6);
    });
  });

  it('different agents accumulate independently on the same day', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const now = Date.UTC(2026, 4, 18);
      await addDailySpendUsd(ctx, { agentId: 'twin-A', costUsd: 0.05, now });
      await addDailySpendUsd(ctx, { agentId: 'twin-B', costUsd: 0.07, now });
      expect(await getDailySpendUsd(ctx, 'twin-A', now)).toBeCloseTo(0.05);
      expect(await getDailySpendUsd(ctx, 'twin-B', now)).toBeCloseTo(0.07);
    });
  });

  it('UTC midnight rolls the bucket — yesterday\'s spend does not bleed into today', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const yesterday = Date.UTC(2026, 4, 18, 23);
      const today = Date.UTC(2026, 4, 19, 1);
      await addDailySpendUsd(ctx, {
        agentId: 'twin-A',
        costUsd: 0.49,
        now: yesterday,
      });
      expect(await getDailySpendUsd(ctx, 'twin-A', yesterday)).toBeCloseTo(
        0.49,
      );
      // Crossed midnight: today's bucket is empty.
      expect(await getDailySpendUsd(ctx, 'twin-A', today)).toBe(0);
    });
  });
});
