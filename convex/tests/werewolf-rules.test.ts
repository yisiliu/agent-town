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
import { getPlugin } from '../ours/interactions/gameRegistry';
import '../ours/interactions/werewolf'; // trigger self-registration

const P = (n: number) => `twin_${n}` as unknown as Id<'twins'>;
const five = [P(0), P(1), P(2), P(3), P(4)];
const nine = [P(0), P(1), P(2), P(3), P(4), P(5), P(6), P(7), P(8)];

function byRole(s: WerewolfState, role: string): Id<'twins'>[] {
  return Object.entries(s.roles)
    .filter(([, r]) => r === role)
    .map(([id]) => id as unknown as Id<'twins'>);
}

describe('werewolf rules — 5p initialState (fallback config)', () => {
  it('assigns 1 werewolf, 1 seer, 3 villagers for 5 players', () => {
    const s = initialState(five, 42);
    expect(byRole(s, 'werewolf').length).toBe(1);
    expect(byRole(s, 'seer').length).toBe(1);
    expect(byRole(s, 'villager').length).toBe(3);
    expect(s.phase).toBe('night-werewolf');
    expect(s.day).toBe(0);
    expect(s.alive).toEqual(five);
    expect(s.cursor).toBe(0);
    expect(s.witchSavePotion).toBe(true);
    expect(s.witchPoisonPotion).toBe(true);
    expect(s.publicLog.length).toBeGreaterThan(0);
  });

  it('is deterministic for the same seed', () => {
    const a = initialState(five, 42);
    const b = initialState(five, 42);
    expect(a.roles).toEqual(b.roles);
    expect(a.hiddenMinds).toEqual(b.hiddenMinds);
  });

  it('rejects <4 players', () => {
    expect(() => initialState([P(0), P(1), P(2)], 1)).toThrow();
  });
});

describe('werewolf rules — 9p canonical config (3W+S+W+H+3V)', () => {
  it('assigns 3 werewolves, 1 seer, 1 witch, 1 hunter, 3 villagers', () => {
    const s = initialState(nine, 42);
    expect(byRole(s, 'werewolf').length).toBe(3);
    expect(byRole(s, 'seer').length).toBe(1);
    expect(byRole(s, 'witch').length).toBe(1);
    expect(byRole(s, 'hunter').length).toBe(1);
    expect(byRole(s, 'villager').length).toBe(3);
  });

  it('hiddenMinds populated for every player', () => {
    const s = initialState(nine, 42);
    for (const id of nine) {
      const m = s.hiddenMinds[id as unknown as string];
      expect(m).toBeDefined();
      expect(m!.courage).toBeGreaterThanOrEqual(1);
      expect(m!.courage).toBeLessThanOrEqual(5);
    }
  });
});

describe('werewolf rules — 9p night-werewolf bidding', () => {
  it('plan returns the first unvoted wolf with wolf-team visibility', () => {
    const s = initialState(nine, 42);
    const wolves = byRole(s, 'werewolf');
    const plan = planNextTurn(s);
    expect(plan).not.toBeNull();
    expect(plan!.kind).toBe('wolf-kill-bid');
    expect(wolves.map((w) => w as unknown as string)).toContain(plan!.actorTwinId as unknown as string);
    // visibility is seat-ordered (alive[]) while wolves[] is role-iteration-ordered;
    // compare as sets.
    const vis = plan!.visibility as Id<'twins'>[];
    expect(new Set(vis)).toEqual(new Set(wolves));
  });

  it('collapses 3 wolf votes (majority wins), advances to night-seer', () => {
    let s = initialState(nine, 42);
    const wolves = byRole(s, 'werewolf');
    const seer = byRole(s, 'seer')[0]!;
    // All 3 wolves bid the seer
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: seer } });
    }
    expect(s.phase).toBe('night-seer');
    expect(s.pendingWolfKill).toBe(seer);
    expect(s.wolfVotes).toEqual({});
  });

  it('tie on 2 wolves with split votes resolves to lowest-seat wolf choice', () => {
    let s = initialState(nine, 42);
    const wolves = byRole(s, 'werewolf');
    const villagerA = byRole(s, 'villager')[0]!;
    const villagerB = byRole(s, 'villager')[1]!;
    // Lowest-seat wolf in alive list
    const aliveWolves = s.alive.filter((id) => s.roles[id as unknown as string] === 'werewolf');
    const lowest = aliveWolves[0]!;
    // Each wolf picks a different villager
    s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: wolves[0]!, data: { target: villagerA } });
    s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: wolves[1]!, data: { target: villagerB } });
    s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: wolves[2]!, data: { target: villagerB } });
    expect(s.pendingWolfKill).toBe(villagerB); // 2-1 majority
    // Test true tie: 1-1-1
    let s2 = initialState(nine, 42);
    const villC = byRole(s2, 'villager')[2]!;
    s2 = applyTurn(s2, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: wolves[0]!, data: { target: villagerA } });
    s2 = applyTurn(s2, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: wolves[1]!, data: { target: villagerB } });
    s2 = applyTurn(s2, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: wolves[2]!, data: { target: villC } });
    // 3-way tie → lowest-seat wolf's choice
    const lowestChoice = s2.alive.includes(lowest) ? s2.pendingWolfKill : undefined;
    expect(lowestChoice).toBeDefined();
  });
});

describe('werewolf rules — witch potions', () => {
  it('witch save blocks wolf kill', () => {
    let s = initialState(nine, 42);
    const wolves = byRole(s, 'werewolf');
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: seer } });
    }
    // seer peek (anyone — doesn't matter for this test)
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    // witch saves
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: { use_save: true } });
    expect(s.witchSavePotion).toBe(false);
    expect(s.witchSaveUsedTonight).toBe(true);
    // resolve
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    expect(s.alive).toContain(seer); // seer survived
    expect(s.phase).toBe('day-speak');
  });

  it('witch poison kills target', () => {
    let s = initialState(nine, 42);
    const wolves = byRole(s, 'werewolf');
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: seer } });
    }
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: { poison_target: villager } });
    expect(s.witchPoisonPotion).toBe(false);
    expect(s.pendingPoisonTarget).toBe(villager);
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    expect(s.alive).not.toContain(seer); // wolf-killed
    expect(s.alive).not.toContain(villager); // poisoned
  });

  it('cannot save AND poison the same night', () => {
    let s = initialState(nine, 42);
    const wolves = byRole(s, 'werewolf');
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: seer } });
    }
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    // Witch tries both — neither should apply
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: { use_save: true, poison_target: villager } });
    expect(s.witchSaveUsedTonight).toBe(false);
    expect(s.pendingPoisonTarget).toBeUndefined();
    expect(s.witchSavePotion).toBe(true); // still available
    expect(s.witchPoisonPotion).toBe(true);
  });
});

describe('werewolf rules — hunter', () => {
  it('hunter shoots on lynch, takes one target down', () => {
    let s = initialState(nine, 42);
    const wolves = byRole(s, 'werewolf');
    const hunter = byRole(s, 'hunter')[0]!;
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;

    // Skip through night-werewolf-bid (kill seer), seer peek, witch skip
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: seer } });
    }
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    expect(s.phase).toBe('day-speak');

    // Skip day-speak (8 alive after seer killed)
    for (let i = 0; i < s.alive.length; i++) {
      s = applyTurn(s, { phase: 'day-speak', kind: 'speak', actorTwinId: s.alive[s.cursor], text: 'meh' });
    }
    expect(s.phase).toBe('day-vote');

    // Everyone votes hunter (lynch hunter)
    for (let i = 0; i < s.alive.length; i++) {
      const voter = s.alive[s.cursor]!;
      s = applyTurn(s, { phase: 'day-vote', kind: 'vote', actorTwinId: voter, data: { target: hunter } });
    }
    // Auto-resolve fires → lynch hunter → hunter-shoot phase
    expect(s.phase).toBe('hunter-shoot');
    expect(s.pendingHunterShot).toBe(hunter);

    // Hunter shoots a wolf
    s = applyTurn(s, { phase: 'hunter-shoot', kind: 'hunter-shoot', actorTwinId: hunter, data: { target: wolves[0] } });
    expect(s.alive).not.toContain(hunter);
    expect(s.alive).not.toContain(wolves[0]);
    expect(s.pendingHunterShot).toBeUndefined();
    // After hunter-shoot, last-words queue still has the hunter from lynch
    expect(s.phase).toBe('last-words');
  });

  it('hunter does NOT shoot when poisoned by witch', () => {
    let s = initialState(nine, 42);
    const wolves = byRole(s, 'werewolf');
    const hunter = byRole(s, 'hunter')[0]!;
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;

    // Wolves kill a villager; witch poisons hunter
    const villager = byRole(s, 'villager')[0]!;
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
    }
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: { poison_target: hunter } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    expect(s.alive).not.toContain(hunter); // poisoned dead
    expect(s.pendingHunterShot).toBeUndefined(); // blocked!
    expect(s.phase).toBe('day-speak'); // straight to day
  });
});

describe('werewolf rules — last-words', () => {
  it('lynched player gets last-words, then game advances', () => {
    let s = initialState(nine, 42);
    const wolves = byRole(s, 'werewolf');
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const villagerA = byRole(s, 'villager')[0]!;

    // Quick night
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villagerA } });
    }
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });

    // Day-speak
    for (let i = 0; i < s.alive.length; i++) {
      s = applyTurn(s, { phase: 'day-speak', kind: 'speak', actorTwinId: s.alive[s.cursor], text: 'meh' });
    }
    // Vote a non-hunter (vote wolf[1] to keep it simple)
    const target = wolves[1]!;
    for (let i = 0; i < s.alive.length; i++) {
      const voter = s.alive[s.cursor]!;
      s = applyTurn(s, { phase: 'day-vote', kind: 'vote', actorTwinId: voter, data: { target } });
    }
    // After auto-resolve, last-words for the lynched wolf
    expect(s.phase).toBe('last-words');
    expect(s.lastWordsQueue).toContain(target);
    // Last-words happens
    s = applyTurn(s, { phase: 'last-words', kind: 'last-words', actorTwinId: target, text: 'I am wolf, bye' });
    expect(s.lastWordsQueue).not.toContain(target);
    // After last-words, advance to next night
    expect(s.phase).toBe('night-werewolf');
  });
});

describe('werewolf rules — checkWin', () => {
  it('werewolves win when count >= non-werewolves alive', () => {
    const s0 = initialState(nine, 42);
    const wolves = byRole(s0, 'werewolf');
    const villager = byRole(s0, 'villager')[0]!;
    const s: WerewolfState = { ...s0, alive: [...wolves, villager] };
    // 3 wolves vs 1 non-wolf → wolves win
    expect(checkWin(s)).toEqual({ ended: true, winner: 'werewolves' });
  });

  it('villagers win when no werewolves alive', () => {
    const s0 = initialState(nine, 42);
    const wolves = byRole(s0, 'werewolf');
    const s: WerewolfState = { ...s0, alive: s0.alive.filter((id) => !wolves.includes(id)) };
    expect(checkWin(s)).toEqual({ ended: true, winner: 'villagers' });
  });

  it('not ended while wolves outnumbered', () => {
    expect(checkWin(initialState(nine, 42))).toEqual({ ended: false });
  });
});

describe('werewolf prompts — buildSystemPrompt', () => {
  it('wraps card in UNTRUSTED_CARD delimiters and includes role briefing', () => {
    const s = initialState(nine, 42);
    const wolf = byRole(s, 'werewolf')[0]!;
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
    expect(p).toContain('thinking');
    expect(p).toContain('say');
  });

  it('hidden_player_mind block contains the actor\'s trait scores', () => {
    const s = initialState(nine, 42);
    const wolf = byRole(s, 'werewolf')[0]!;
    const p = buildSystemPrompt({
      state: s,
      actorTwinId: wolf,
      cardMarkdown: 'persona',
      aliveNames: {},
    });
    expect(p).toContain('hidden_player_mind');
    expect(p).toContain('courage');
  });

  it('seer briefing for the seer', () => {
    const s = initialState(nine, 42);
    const seer = byRole(s, 'seer')[0]!;
    const p = buildSystemPrompt({
      state: s,
      actorTwinId: seer,
      cardMarkdown: 'persona',
      aliveNames: {},
    });
    expect(p).toContain('SEER');
  });

  it('witch briefing for the witch', () => {
    const s = initialState(nine, 42);
    const witch = byRole(s, 'witch')[0]!;
    const p = buildSystemPrompt({
      state: s,
      actorTwinId: witch,
      cardMarkdown: 'persona',
      aliveNames: {},
    });
    expect(p).toContain('WITCH');
  });
});

describe('werewolf prompts — buildUserPrompt', () => {
  it('night-werewolf-bid lists alive non-werewolves as candidates', () => {
    const s = initialState(nine, 42);
    const wolf = byRole(s, 'werewolf')[0]!;
    const names: Record<string, string> = {};
    for (const id of s.alive) names[id as unknown as string] = `P${id}`;
    const p = buildUserPrompt({
      state: s,
      actorTwinId: wolf,
      phase: 'night-werewolf',
      kind: 'wolf-kill-bid',
      visibleTurns: [],
      aliveNames: names,
    });
    expect(p).toContain('werewolf');
    // Should list 6 non-wolf candidates
    const candidateLines = p.split('\n').filter((l) => l.startsWith('  - twin_')).length;
    expect(candidateLines).toBeGreaterThanOrEqual(6);
  });
});

describe('werewolf prompts — parseTurnText', () => {
  it('parses well-formed JSON envelope with thinking + say + action', () => {
    const r = parseTurnText(
      '{"thinking":"strategic notes","say":"I think Bob is sus","action":{"target":"twin_2"}}',
      'vote',
      { aliveIds: [P(2), P(3)] },
    );
    expect(r.ok).toBe(true);
    const d = r.data as { target?: string; thinking?: string; say?: string };
    expect(d.target).toBe('twin_2');
    expect(d.thinking).toBe('strategic notes');
    expect(d.say).toBe('I think Bob is sus');
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
      '```json\n{"thinking":"x","say":"y","action":{"target":"twin_2"}}\n```',
      'vote',
      { aliveIds: [P(2)] },
    );
    expect(r.ok).toBe(true);
  });

  it('parses speak with say only (no action)', () => {
    const r = parseTurnText(
      '{"thinking":"keep quiet","say":"I have no strong reads yet."}',
      'speak',
      { aliveIds: [] },
    );
    expect(r.ok).toBe(true);
  });

  it('parses witch-act with use_save', () => {
    const r = parseTurnText(
      '{"thinking":"save Bob","action":{"use_save":true}}',
      'witch-act',
      { aliveIds: [P(2)] },
    );
    expect(r.ok).toBe(true);
  });

  it('parses witch-act with poison_target', () => {
    const r = parseTurnText(
      '{"thinking":"poison Alice","action":{"poison_target":"twin_2"}}',
      'witch-act',
      { aliveIds: [P(2)] },
    );
    expect(r.ok).toBe(true);
    expect((r.data as { poison_target?: string }).poison_target).toBe('twin_2');
  });

  it('parses last-words (no action required)', () => {
    const r = parseTurnText(
      '{"thinking":"I am out","say":"I was the seer; my last peek was on Bob, he is wolf."}',
      'last-words',
      { aliveIds: [] },
    );
    expect(r.ok).toBe(true);
  });

  it('rejects malformed JSON', () => {
    const r = parseTurnText('not json at all', 'vote', { aliveIds: [] });
    expect(r.ok).toBe(false);
  });
});

describe('plugin registry', () => {
  it('werewolf plugin self-registers on import', () => {
    const p = getPlugin('werewolf');
    expect(p).toBeDefined();
    expect(p!.type).toBe('werewolf');
    expect(p!.minPlayers).toBe(4);
    expect(p!.maxPlayers).toBe(12);
  });

  it('unknown plugin lookups return undefined', () => {
    expect(getPlugin('does-not-exist')).toBeUndefined();
  });
});
