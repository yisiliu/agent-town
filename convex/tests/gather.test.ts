import { describe, it, expect } from 'vitest';
import { nextGatherAction } from '../ours/interactions/gather';

const conv = (id: string, pids: string[]) => ({
  id,
  participants: pids.map((p) => ({ playerId: p })),
});

describe('nextGatherAction', () => {
  it('free player → pull', () => {
    expect(nextGatherAction('p:1', [], 0, 1000)).toEqual({ kind: 'pull' });
    expect(nextGatherAction('p:1', [conv('c:1', ['p:2', 'p:3'])], 0, 1000)).toEqual({
      kind: 'pull',
    });
  });

  it('talking & <30s → wait', () => {
    expect(
      nextGatherAction('p:1', [conv('c:1', ['p:1', 'p:2'])], 0, 10_000),
    ).toEqual({ kind: 'wait' });
    // boundary: just under 30s still waits
    expect(
      nextGatherAction('p:1', [conv('c:1', ['p:1', 'p:2'])], 0, 29_999),
    ).toEqual({ kind: 'wait' });
  });

  it('talking & ≥30s → forceLeave with conversationId', () => {
    expect(
      nextGatherAction('p:1', [conv('c:9', ['p:1', 'p:2'])], 0, 30_000),
    ).toEqual({ kind: 'forceLeave', conversationId: 'c:9' });
  });
});
