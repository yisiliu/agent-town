import { describe, it, expect } from 'vitest';
import { synthesizeCardForAgent, dungeonTwinHashKey } from '../ours/lib/dungeonBridge';

describe('dungeonBridge — synthesizeCardForAgent', () => {
  it('produces a non-empty Markdown card with all 5 sections', () => {
    const md = synthesizeCardForAgent({
      name: 'Alice',
      description: 'A curious librarian who collects rare maps.',
      character: 'f1',
      identity: 'Alice is in her late 20s and reads more books than she sleeps.',
      plan: 'You want to discover one new place every week.',
    });
    expect(md).toContain('# Alice');
    expect(md).toContain('## 一句话定位');
    expect(md).toContain('## 来历与身份');
    expect(md).toContain('## 目标与心愿');
    expect(md).toContain('rare maps');
    expect(md).toContain('discover one new place');
  });

  it('handles missing identity gracefully', () => {
    const md = synthesizeCardForAgent({
      name: 'Bob',
      description: '',
      character: 'p1',
      identity: 'Bob loves grilled fish and disapproves of indoor cats.',
      plan: '',
    });
    expect(md).toContain('# Bob');
    expect(md).toContain('Bob loves grilled fish');
  });

  it('trims overly long fields so the system prompt stays bounded', () => {
    const longIdentity = 'X'.repeat(2000);
    const md = synthesizeCardForAgent({
      name: 'LongFella',
      description: '',
      character: 'p1',
      identity: longIdentity,
      plan: '',
    });
    // Identity is trimmed to 400 chars + ellipsis somewhere
    expect(md).toContain('LongFella');
    expect(md.length).toBeLessThan(1500);
  });
});

describe('dungeonBridge — dungeonTwinHashKey', () => {
  it('produces a deterministic key per (worldId, playerId) pair', () => {
    const a = dungeonTwinHashKey('w1', 'p1');
    const b = dungeonTwinHashKey('w1', 'p1');
    expect(a).toBe(b);
  });

  it('differs per playerId', () => {
    expect(dungeonTwinHashKey('w1', 'p1')).not.toBe(dungeonTwinHashKey('w1', 'p2'));
  });

  it('differs per worldId', () => {
    expect(dungeonTwinHashKey('w1', 'p1')).not.toBe(dungeonTwinHashKey('w2', 'p1'));
  });
});
