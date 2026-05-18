import { describe, it, expect } from 'vitest';
import {
  shouldPingRunpod,
  WARMUP_LEAD_MS,
  WARMUP_TOLERANCE_MS,
} from '../ours/lib/runpodWarmupCore';
import { parseRunpodReply } from '../ours/lib/runpodClient';

const MIN = 60 * 1_000;

describe('shouldPingRunpod', () => {
  it('returns false when no session is scheduled', () => {
    expect(shouldPingRunpod(0, null)).toBe(false);
  });

  it('pings exactly at the 5-minute mark before class start', () => {
    const now = 1_700_000_000_000;
    const start = now + WARMUP_LEAD_MS;
    expect(shouldPingRunpod(now, start)).toBe(true);
  });

  it('pings within the ±1-minute tolerance band (covers cron jitter)', () => {
    const now = 1_700_000_000_000;
    expect(
      shouldPingRunpod(now, now + WARMUP_LEAD_MS - WARMUP_TOLERANCE_MS),
    ).toBe(true);
    expect(
      shouldPingRunpod(now, now + WARMUP_LEAD_MS + WARMUP_TOLERANCE_MS),
    ).toBe(true);
  });

  it('does NOT ping outside the tolerance band (too early)', () => {
    const now = 1_700_000_000_000;
    expect(shouldPingRunpod(now, now + 7 * MIN)).toBe(false);
  });

  it('does NOT ping outside the tolerance band (too late, class already started)', () => {
    const now = 1_700_000_000_000;
    expect(shouldPingRunpod(now, now + 3 * MIN)).toBe(false);
    expect(shouldPingRunpod(now, now)).toBe(false);
    expect(shouldPingRunpod(now, now - 60 * MIN)).toBe(false);
  });
});

describe('parseRunpodReply', () => {
  it('parses a COMPLETED reply with choices + usage', () => {
    const out = parseRunpodReply({
      status: 'COMPLETED',
      output: {
        choices: [{ message: { content: 'a small green thought' } }],
        usage: { prompt_tokens: 12, completion_tokens: 5 },
      },
    });
    expect(out.text).toBe('a small green thought');
    expect(out.usage).toEqual({ input_tokens: 12, output_tokens: 5 });
  });

  it('defaults missing usage fields to 0', () => {
    const out = parseRunpodReply({
      status: 'COMPLETED',
      output: { choices: [{ message: { content: 'hi' } }] },
    });
    expect(out.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });

  it('throws on non-COMPLETED status (caller treats as silence)', () => {
    expect(() =>
      parseRunpodReply({ status: 'FAILED', output: null }),
    ).toThrow(/FAILED/);
  });

  it('throws on missing message content', () => {
    expect(() =>
      parseRunpodReply({ status: 'COMPLETED', output: { choices: [] } }),
    ).toThrow(/missing/);
  });
});
