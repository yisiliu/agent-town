import { describe, it, expect } from 'vitest';
import { isTownInert } from '../ours/lib/watchdogWedge';

const player = {};

describe('isTownInert', () => {
  it('false when there are no players (no town to recover)', () => {
    expect(isTownInert({ conversations: [], players: [] })).toBe(false);
  });
  it('false when at least one conversation is active', () => {
    expect(isTownInert({ conversations: [{}], players: [player, player] })).toBe(false);
  });
  it('true when there are zero conversations (movement is irrelevant — it flickers)', () => {
    expect(isTownInert({ conversations: [], players: [player, player] })).toBe(true);
  });
});
