import { describe, it, expect } from 'vitest';
import { parseLlamaGuardReply } from '../ours/lib/togetherClient';

describe('parseLlamaGuardReply', () => {
  it('parses bare "safe"', () => {
    expect(parseLlamaGuardReply('safe')).toEqual({ verdict: 'safe' });
  });

  it('parses "safe" surrounded by whitespace', () => {
    expect(parseLlamaGuardReply('  safe  \n')).toEqual({ verdict: 'safe' });
  });

  it('parses "unsafe\\nS1" as unsafe with single category', () => {
    expect(parseLlamaGuardReply('unsafe\nS1')).toEqual({
      verdict: 'unsafe',
      categories: ['S1'],
    });
  });

  it('parses comma-separated categories', () => {
    expect(parseLlamaGuardReply('unsafe\nS1, S14')).toEqual({
      verdict: 'unsafe',
      categories: ['S1', 'S14'],
    });
  });

  it('treats bare "unsafe" with no category line as unsafe', () => {
    expect(parseLlamaGuardReply('unsafe')).toEqual({ verdict: 'unsafe' });
  });

  it('is case-insensitive on the verdict word', () => {
    expect(parseLlamaGuardReply('SAFE')).toEqual({ verdict: 'safe' });
    expect(parseLlamaGuardReply('Unsafe\nS2')).toEqual({
      verdict: 'unsafe',
      categories: ['S2'],
    });
  });

  it('throws on unrecognized verbs (caller fail-closes)', () => {
    expect(() => parseLlamaGuardReply('definitely-bad')).toThrow(
      /unparseable/,
    );
  });
});
