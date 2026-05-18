import { describe, it, expect } from 'vitest';
import { isTickAllowedFor } from '../../ai-town-fork/convex/ours/townHooks';

describe('isTickAllowedFor — pure gate predicate', () => {
  it('returns true when no worldStatus row exists (fresh deploy)', () => {
    expect(isTickAllowedFor(null)).toBe(true);
  });

  it('returns true when state is live', () => {
    expect(isTickAllowedFor({ state: 'live', nextChange: null })).toBe(true);
  });

  it('returns false when state is frozen', () => {
    expect(isTickAllowedFor({ state: 'frozen', nextChange: null })).toBe(false);
  });

  it('ignores nextChange when deciding gate', () => {
    expect(
      isTickAllowedFor({ state: 'frozen', nextChange: Date.now() + 60_000 }),
    ).toBe(false);
    expect(
      isTickAllowedFor({ state: 'live', nextChange: Date.now() + 60_000 }),
    ).toBe(true);
  });
});
