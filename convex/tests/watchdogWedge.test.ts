import { describe, it, expect } from 'vitest';
import { isTownWedged } from '../ours/lib/watchdogWedge';

const op = { started: 1 };

describe('isTownWedged', () => {
  it('false when no agents', () => {
    expect(isTownWedged([])).toBe(false);
  });
  it('false when at least one agent is free (no inProgressOperation)', () => {
    expect(isTownWedged([{ inProgressOperation: op }, {}])).toBe(false);
    expect(isTownWedged([{}, {}])).toBe(false);
  });
  it('true when EVERY agent is stuck on an inProgressOperation', () => {
    expect(isTownWedged([{ inProgressOperation: op }])).toBe(true);
    expect(isTownWedged([{ inProgressOperation: op }, { inProgressOperation: op }])).toBe(true);
  });
});
