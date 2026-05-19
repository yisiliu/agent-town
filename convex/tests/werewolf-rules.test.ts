/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import type { Id } from '../_generated/dataModel';
import {
  initialState,
  planNextTurn,
  applyTurn,
  checkWin,
} from '../ours/interactions/werewolf/rules';
import {
  buildSystemPrompt,
  buildUserPrompt,
  parseTurnText,
} from '../ours/interactions/werewolf/prompts';
import type { WerewolfState } from '../ours/interactions/werewolf/state';

const P = (n: number) => `twin_${n}` as unknown as Id<'twins'>;
const five = [P(0), P(1), P(2), P(3), P(4)];

function werewolfOf(s: WerewolfState) {
  return Object.entries(s.roles).find(([, r]) => r === 'werewolf')![0] as unknown as Id<'twins'>;
}
function seerOf(s: WerewolfState) {
  return Object.entries(s.roles).find(([, r]) => r === 'seer')![0] as unknown as Id<'twins'>;
}

describe('werewolf rules — initialState', () => {
  it('assigns 1 werewolf, 1 seer, 3 villagers for 5 players', () => {
    const s = initialState(five, 42);
    const roles = Object.values(s.roles);
    expect(roles.filter((r) => r === 'werewolf').length).toBe(1);
    expect(roles.filter((r) => r === 'seer').length).toBe(1);
    expect(roles.filter((r) => r === 'villager').length).toBe(3);
    expect(s.phase).toBe('night-werewolf');
    expect(s.day).toBe(0);
    expect(s.alive).toEqual(five);
    expect(s.cursor).toBe(0);
    expect(s.publicLog.length).toBeGreaterThan(0);
  });

  it('is deterministic for the same seed', () => {
    const a = initialState(five, 42);
    const b = initialState(five, 42);
    expect(a.roles).toEqual(b.roles);
  });

  it('rejects <4 players', () => {
    expect(() => initialState([P(0), P(1), P(2)], 1)).toThrow();
  });
});

describe('werewolf rules — planNextTurn', () => {
  it('returns the werewolf for night-werewolf phase, private visibility', () => {
    const s = initialState(five, 42);
    const plan = planNextTurn(s);
    expect(plan).not.toBeNull();
    expect(plan!.kind).toBe('kill');
    expect(plan!.actorTwinId).toBe(werewolfOf(s));
    expect(Array.isArray(plan!.visibility)).toBe(true);
    expect(plan!.visibility as Id<'twins'>[]).toEqual([werewolfOf(s)]);
  });
});

describe('werewolf rules — night-werewolf-kill', () => {
  it('applyTurn for kill sets pendingKill and advances to night-seer', () => {
    let s = initialState(five, 42);
    const werewolf = werewolfOf(s);
    const target = s.alive.find((id) => id !== werewolf)!;
    s = applyTurn(s, {
      phase: 'night-werewolf',
      kind: 'kill',
      actorTwinId: werewolf,
      data: { target },
    });
    expect(s.pendingKill).toBe(target);
    expect(s.phase).toBe('night-seer');
  });
});

describe('werewolf rules — night-seer-peek', () => {
  it('seer peek records seerKnowledge and advances to night-resolve', () => {
    let s = initialState(five, 42);
    const werewolf = werewolfOf(s);
    const seer = seerOf(s);
    const villager = s.alive.find((id) => id !== werewolf && id !== seer)!;
    // advance through night-werewolf-kill first
    s = applyTurn(s, {
      phase: 'night-werewolf',
      kind: 'kill',
      actorTwinId: werewolf,
      data: { target: villager },
    });
    expect(s.phase).toBe('night-seer');
    s = applyTurn(s, {
      phase: 'night-seer',
      kind: 'peek',
      actorTwinId: seer,
      data: { target: werewolf },
    });
    expect(s.seerKnowledge.length).toBe(1);
    expect(s.seerKnowledge[0].target).toBe(werewolf);
    expect(s.seerKnowledge[0].role).toBe('werewolf');
    expect(s.phase).toBe('night-resolve');
  });
});

describe('werewolf rules — night-resolve', () => {
  it('removes pendingKill from alive, logs, advances to day-speak', () => {
    let s = initialState(five, 42);
    const werewolf = werewolfOf(s);
    const seer = seerOf(s);
    const victim = s.alive.find((id) => id !== werewolf && id !== seer)!;
    s = applyTurn(s, { phase: 'night-werewolf', kind: 'kill', actorTwinId: werewolf, data: { target: victim } });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: werewolf } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    expect(s.alive).not.toContain(victim);
    expect(s.alive.length).toBe(4);
    expect(s.phase).toBe('day-speak');
    expect(s.cursor).toBe(0);
    expect(s.pendingKill).toBeUndefined();
    expect(s.publicLog.some((l) => l.includes('killed') || l.includes('found dead'))).toBe(true);
  });
});

describe('werewolf rules — day-speak', () => {
  it('planNextTurn iterates alive in order, then advances to day-vote', () => {
    let s = initialState(five, 42);
    const werewolf = werewolfOf(s);
    const seer = seerOf(s);
    const victim = s.alive.find((id) => id !== werewolf && id !== seer)!;
    s = applyTurn(s, { phase: 'night-werewolf', kind: 'kill', actorTwinId: werewolf, data: { target: victim } });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: werewolf } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    // s.alive now has 4 players, all should speak in order
    const speakers: Id<'twins'>[] = [];
    for (let i = 0; i < 4; i++) {
      const plan = planNextTurn(s);
      expect(plan!.kind).toBe('speak');
      expect(plan!.phase).toBe('day-speak');
      speakers.push(plan!.actorTwinId!);
      s = applyTurn(s, { phase: 'day-speak', kind: 'speak', actorTwinId: plan!.actorTwinId, text: 'I have nothing to say' });
    }
    expect(speakers).toEqual(s.alive); // round preserves order
    expect(s.phase).toBe('day-vote');
    expect(s.cursor).toBe(0);
  });
});

describe('werewolf rules — day-vote', () => {
  it('all alive vote, then day-resolve eliminates majority target', () => {
    let s = initialState(five, 42);
    const werewolf = werewolfOf(s);
    const seer = seerOf(s);
    const victim = s.alive.find((id) => id !== werewolf && id !== seer)!;
    s = applyTurn(s, { phase: 'night-werewolf', kind: 'kill', actorTwinId: werewolf, data: { target: victim } });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: werewolf } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    // skip day-speak — just call applyTurn 4 times for vote
    for (let i = 0; i < s.alive.length; i++) {
      s = applyTurn(s, { phase: 'day-speak', kind: 'speak', actorTwinId: s.alive[s.cursor], text: 'meh' });
    }
    // Everyone (incl werewolf) votes for werewolf so villagers win
    for (let i = 0; i < s.alive.length; i++) {
      const voter = s.alive[s.cursor];
      s = applyTurn(s, { phase: 'day-vote', kind: 'vote', actorTwinId: voter, data: { target: werewolf } });
    }
    // All votes in → day-resolve auto-triggers (or planNextTurn returns system kind)
    if (s.phase === 'day-resolve') {
      s = applyTurn(s, { phase: 'day-resolve', kind: 'system', actorTwinId: null });
    }
    expect(s.alive).not.toContain(werewolf);
    expect(s.phase).toBe('ended');
    expect(s.winner).toBe('villagers');
  });

  it('tie vote produces no elimination', () => {
    let s = initialState(five, 42);
    const werewolf = werewolfOf(s);
    const seer = seerOf(s);
    const victim = s.alive.find((id) => id !== werewolf && id !== seer)!;
    s = applyTurn(s, { phase: 'night-werewolf', kind: 'kill', actorTwinId: werewolf, data: { target: victim } });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: werewolf } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    for (let i = 0; i < s.alive.length; i++) {
      s = applyTurn(s, { phase: 'day-speak', kind: 'speak', actorTwinId: s.alive[s.cursor], text: 'meh' });
    }
    // 4 alive: 2 votes for A, 2 votes for B
    const [a, b] = s.alive.slice(0, 2);
    const targets = [a, a, b, b];
    for (let i = 0; i < s.alive.length; i++) {
      const voter = s.alive[s.cursor];
      s = applyTurn(s, { phase: 'day-vote', kind: 'vote', actorTwinId: voter, data: { target: targets[i] } });
    }
    if (s.phase === 'day-resolve') {
      s = applyTurn(s, { phase: 'day-resolve', kind: 'system', actorTwinId: null });
    }
    expect(s.alive.length).toBe(4); // no elimination on tie
    expect(s.publicLog.some((l) => l.toLowerCase().includes('deadlock'))).toBe(true);
    expect(s.phase).toBe('night-werewolf');
    expect(s.day).toBe(1);
  });
});

describe('werewolf prompts — buildSystemPrompt', () => {
  it('wraps card in UNTRUSTED_CARD delimiters and appends role briefing', () => {
    const s = initialState(five, 42);
    const wolf = werewolfOf(s);
    const p = buildSystemPrompt({
      state: s,
      actorTwinId: wolf,
      cardMarkdown: 'I am Alice. I am 25 years old.',
      aliveNames: { [wolf as unknown as string]: 'Alice' },
    });
    expect(p).toContain('<UNTRUSTED_CARD>');
    expect(p).toContain('I am Alice.');
    expect(p).toContain('</UNTRUSTED_CARD>');
    expect(p).toContain('WEREWOLF');
    expect(p).toContain('JSON');
  });

  it('seer briefing for the seer', () => {
    const s = initialState(five, 42);
    const seer = seerOf(s);
    const p = buildSystemPrompt({
      state: s,
      actorTwinId: seer,
      cardMarkdown: 'persona',
      aliveNames: {},
    });
    expect(p).toContain('SEER');
  });
});

describe('werewolf prompts — buildUserPrompt', () => {
  it('night-werewolf-kill lists alive non-werewolves as candidates', () => {
    const s = initialState(five, 42);
    const wolf = werewolfOf(s);
    const names: Record<string, string> = {};
    for (const id of s.alive) names[id as unknown as string] = `P${id}`;
    const p = buildUserPrompt({
      state: s,
      actorTwinId: wolf,
      phase: 'night-werewolf',
      kind: 'kill',
      visibleTurns: [],
      aliveNames: names,
    });
    expect(p).toContain('werewolf');
    // werewolf must not be in candidate list
    expect(p.toLowerCase()).not.toContain(`${(wolf as unknown as string).toLowerCase()} (p${wolf}`);
    // at least 4 non-werewolves should appear
    const candidateLines = p
      .split('\n')
      .filter((l) => l.startsWith('  - twin_'))
      .length;
    expect(candidateLines).toBeGreaterThanOrEqual(4);
  });

  it('day-speak prompt includes seer knowledge for the seer', () => {
    let s = initialState(five, 42);
    const wolf = werewolfOf(s);
    const seer = seerOf(s);
    const victim = s.alive.find((id) => id !== wolf && id !== seer)!;
    s = applyTurn(s, { phase: 'night-werewolf', kind: 'kill', actorTwinId: wolf, data: { target: victim } });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolf } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    const p = buildUserPrompt({
      state: s,
      actorTwinId: seer,
      phase: 'day-speak',
      kind: 'speak',
      visibleTurns: [],
      aliveNames: {},
    });
    expect(p).toContain('SEER KNOWLEDGE');
    expect(p).toContain('werewolf');
  });
});

describe('werewolf prompts — parseTurnText', () => {
  it('parses well-formed JSON envelope for vote', () => {
    const r = parseTurnText(
      '{"reasoning":"Bob acted weird.","action":{"target":"twin_2"}}',
      'vote',
      { aliveIds: [P(2), P(3)] },
    );
    expect(r.ok).toBe(true);
    expect((r.data as { target: string }).target).toBe('twin_2');
  });

  it('rejects target not in alive set', () => {
    const r = parseTurnText(
      '{"action":{"target":"twin_99"}}',
      'vote',
      { aliveIds: [P(2)] },
    );
    expect(r.ok).toBe(false);
  });

  it('tolerates JSON wrapped in code fences', () => {
    const r = parseTurnText(
      '```json\n{"action":{"target":"twin_2"}}\n```',
      'vote',
      { aliveIds: [P(2)] },
    );
    expect(r.ok).toBe(true);
  });

  it('parses speak with no action', () => {
    const r = parseTurnText(
      '{"reasoning":"I am suspicious of Bob."}',
      'speak',
      { aliveIds: [] },
    );
    expect(r.ok).toBe(true);
  });

  it('rejects malformed JSON', () => {
    const r = parseTurnText('not json at all', 'vote', { aliveIds: [] });
    expect(r.ok).toBe(false);
  });

  it('rejects missing action.target on vote', () => {
    const r = parseTurnText('{"reasoning":"hmm"}', 'vote', { aliveIds: [P(2)] });
    expect(r.ok).toBe(false);
  });
});

describe('werewolf rules — checkWin', () => {
  it('werewolves win when alive count >= non-werewolves', () => {
    const s0 = initialState(five, 42);
    const werewolf = werewolfOf(s0);
    const villager = s0.alive.find((id) => s0.roles[id as unknown as string] === 'villager')!;
    const s: WerewolfState = { ...s0, alive: [werewolf, villager] };
    expect(checkWin(s)).toEqual({ ended: true, winner: 'werewolves' });
  });

  it('villagers win when no werewolves alive', () => {
    const s0 = initialState(five, 42);
    const werewolf = werewolfOf(s0);
    const s: WerewolfState = { ...s0, alive: s0.alive.filter((id) => id !== werewolf) };
    expect(checkWin(s)).toEqual({ ended: true, winner: 'villagers' });
  });

  it('not ended while werewolves alive and outnumbered', () => {
    const s = initialState(five, 42);
    expect(checkWin(s)).toEqual({ ended: false });
  });
});
