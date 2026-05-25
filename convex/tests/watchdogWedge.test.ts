import { describe, it, expect } from 'vitest';
import { isTownInert } from '../ours/lib/watchdogWedge';

const moving = { pathfinding: { state: { kind: 'moving' } } };
const idle = {};

describe('isTownInert', () => {
  it('false when there are no players (no town to recover)', () => {
    expect(isTownInert({ conversations: [], players: [] })).toBe(false);
  });
  it('false when someone is conversing', () => {
    expect(isTownInert({ conversations: [{}], players: [idle, idle] })).toBe(false);
  });
  it('false when someone is moving (pathfinding)', () => {
    expect(isTownInert({ conversations: [], players: [moving, idle] })).toBe(false);
  });
  it('true when nobody is conversing AND nobody is moving', () => {
    expect(isTownInert({ conversations: [], players: [idle, idle] })).toBe(true);
  });
});
