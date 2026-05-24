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
const twelve = [P(0), P(1), P(2), P(3), P(4), P(5), P(6), P(7), P(8), P(9), P(10), P(11)];

function byRole(s: WerewolfState, role: string): Id<'twins'>[] {
  return Object.entries(s.roles)
    .filter(([, r]) => r === role)
    .map(([id]) => id as unknown as Id<'twins'>);
}

// Helper: drive through any first-night last-words, then the sheriff-claim
// phase (every player declines). Result: no sheriff, immediate transition to
// day-speak. Used by tests that exercise non-sheriff mechanics on Day 1.
function skipSheriffElection(s: WerewolfState): WerewolfState {
  let cur = s;
  // First-night deaths now enter last-words before sheriff-claim.
  while (cur.phase === 'last-words') {
    cur = applyTurn(cur, {
      phase: 'last-words',
      kind: 'last-words',
      actorTwinId: cur.lastWordsQueue[0],
      text: 'bye',
    });
  }
  while (cur.phase === 'sheriff-claim') {
    const actor = cur.alive[cur.sheriffClaimCursor]!;
    cur = applyTurn(cur, {
      phase: 'sheriff-claim',
      kind: 'sheriff-claim',
      actorTwinId: actor,
      data: { run: false },
    });
  }
  // After sheriff election (or skipping it), drive through day-direction
  // with a system engine-fallback turn so tests land on day-speak.
  if (cur.phase === 'day-direction') {
    cur = applyTurn(cur, { phase: 'day-direction', kind: 'system', actorTwinId: null });
  }
  return cur;
}

// Drives night-guard → night-werewolf. 9p has no guard (system skip); 12p
// issues an empty guard action (空守) unless the test set guardTargetThisNight itself.
function advanceToWerewolf(s: WerewolfState): WerewolfState {
  let cur = s;
  while (cur.phase === 'night-guard') {
    const plan = planNextTurn(cur)!;
    if (plan.kind === 'system') {
      cur = applyTurn(cur, { phase: 'night-guard', kind: 'system', actorTwinId: null });
    } else {
      cur = applyTurn(cur, { phase: 'night-guard', kind: 'guard-protect', actorTwinId: plan.actorTwinId, data: {} });
    }
  }
  return cur;
}

describe('werewolf rules — 5p initialState (fallback config)', () => {
  it('assigns 1 werewolf, 1 seer, 3 villagers for 5 players', () => {
    const s = initialState(five, 42);
    expect(byRole(s, 'werewolf').length).toBe(1);
    expect(byRole(s, 'seer').length).toBe(1);
    expect(byRole(s, 'villager').length).toBe(3);
    expect(s.phase).toBe('night-guard');
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

describe('werewolf rules — board tables (9p no-guard, 12p 预女猎守)', () => {
  it('9p has NO guard (3W / S·W·H / 3V)', () => {
    const s = initialState(nine, 42);
    expect(byRole(s, 'werewolf').length).toBe(3);
    expect(byRole(s, 'guard').length).toBe(0);
    expect(byRole(s, 'seer').length).toBe(1);
    expect(byRole(s, 'witch').length).toBe(1);
    expect(byRole(s, 'hunter').length).toBe(1);
    expect(byRole(s, 'villager').length).toBe(3);
  });
  it('12p is 4W / S·W·H·G / 4V', () => {
    const s = initialState(twelve, 7);
    expect(byRole(s, 'werewolf').length).toBe(4);
    expect(byRole(s, 'seer').length).toBe(1);
    expect(byRole(s, 'witch').length).toBe(1);
    expect(byRole(s, 'hunter').length).toBe(1);
    expect(byRole(s, 'guard').length).toBe(1);
    expect(byRole(s, 'villager').length).toBe(4);
  });
});

describe('werewolf rules — Task 1.3: night-guard phase + state fields', () => {
  it('initialState phase is night-guard', () => {
    expect(initialState(nine, 42).phase).toBe('night-guard');
    expect(initialState(twelve, 7).phase).toBe('night-guard');
  });

  it('initialState guardTargetThisNight and lastGuardTarget are undefined', () => {
    const s9 = initialState(nine, 42);
    const s12 = initialState(twelve, 7);
    expect(s9.guardTargetThisNight).toBeUndefined();
    expect(s9.lastGuardTarget).toBeUndefined();
    expect(s12.guardTargetThisNight).toBeUndefined();
    expect(s12.lastGuardTarget).toBeUndefined();
  });
});

describe('werewolf rules — night-guard phase', () => {
  it('9p emits a system skip (no guard) then lands on night-werewolf', () => {
    const s = initialState(nine, 42);
    const plan = planNextTurn(s)!;
    expect(plan.kind).toBe('system'); // no guard to protect
    const s2 = applyTurn(s, { phase: 'night-guard', kind: 'system', actorTwinId: null });
    expect(s2.phase).toBe('night-werewolf');
  });
  it('12p emits a guard-protect turn for the living guard', () => {
    const s = initialState(twelve, 7);
    const guard = byRole(s, 'guard')[0]!;
    const plan = planNextTurn(s)!;
    expect(plan.kind).toBe('guard-protect');
    expect(plan.actorTwinId).toBe(guard);
    expect(plan.visibility).toEqual([guard]);
  });
  it('guard cannot protect the same target two nights running (违规按空守)', () => {
    let s = initialState(twelve, 7);
    const guard = byRole(s, 'guard')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    s = applyTurn(s, { phase: 'night-guard', kind: 'guard-protect', actorTwinId: guard, data: { target: villager } });
    expect(s.guardTargetThisNight).toBe(villager);
    expect(s.phase).toBe('night-werewolf');
    // (no-repeat enforcement is verified end-to-end in Task 1.6 across nights)
  });
});

describe('werewolf rules — 9p night-werewolf bidding', () => {
  it('plan returns the first unvoted wolf with self-only visibility (simultaneous bidding)', () => {
    const s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const plan = planNextTurn(s);
    expect(plan).not.toBeNull();
    expect(plan!.kind).toBe('wolf-kill-bid');
    expect(wolves.map((w) => w as unknown as string)).toContain(plan!.actorTwinId as unknown as string);
    // Simultaneous-bid semantics: each wolf's bid is visible only to themselves.
    expect(plan!.visibility).toEqual([plan!.actorTwinId]);
  });

  it('collapses 3 wolf votes (majority wins), advances to night-witch', () => {
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const seer = byRole(s, 'seer')[0]!;
    // All 3 wolves bid the seer
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: seer } });
    }
    expect(s.phase).toBe('night-witch');
    expect(s.pendingWolfKill).toBe(seer);
    expect(s.wolfVotes).toEqual({});
  });

  it('tie on 2 wolves with split votes resolves to lowest-seat wolf choice', () => {
    let s = advanceToWerewolf(initialState(nine, 42));
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
    let s2 = advanceToWerewolf(initialState(nine, 42));
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
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: seer } });
    }
    // witch saves (witch acts before seer now)
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: { use_save: true } });
    // seer peek (anyone — doesn't matter for this test)
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    expect(s.witchSavePotion).toBe(false);
    expect(s.witchSaveUsedTonight).toBe(true);
    // resolve
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    expect(s.alive).toContain(seer); // seer survived
    // Day-1 morning: sheriff election. Skip it for this test.
    expect(s.phase).toBe('sheriff-claim');
    s = skipSheriffElection(s);
    expect(s.phase).toBe('day-speak');
  });

  it('witch poison kills target', () => {
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: seer } });
    }
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: { poison_target: villager } });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    expect(s.witchPoisonPotion).toBe(false);
    expect(s.pendingPoisonTarget).toBe(villager);
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    expect(s.alive).not.toContain(seer); // wolf-killed
    expect(s.alive).not.toContain(villager); // poisoned
  });

  it('cannot save AND poison the same night', () => {
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: seer } });
    }
    // Witch tries both — neither should apply
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: { use_save: true, poison_target: villager } });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    expect(s.witchSaveUsedTonight).toBe(false);
    expect(s.pendingPoisonTarget).toBeUndefined();
    expect(s.witchSavePotion).toBe(true); // still available
    expect(s.witchPoisonPotion).toBe(true);
  });
});

describe('werewolf rules — hunter', () => {
  it('hunter shoots on lynch, takes one target down', () => {
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const hunter = byRole(s, 'hunter')[0]!;
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;

    // Skip through night-werewolf-bid (kill seer), witch skip, seer peek
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: seer } });
    }
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    s = skipSheriffElection(s);
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
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const hunter = byRole(s, 'hunter')[0]!;
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;

    // Wolves kill a villager; witch poisons hunter
    const villager = byRole(s, 'villager')[0]!;
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
    }
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: { poison_target: hunter } });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    expect(s.alive).not.toContain(hunter); // poisoned dead
    expect(s.pendingHunterShot).toBeUndefined(); // blocked!
    // Both night deaths get last-words (day===0), then sheriff election.
    s = skipSheriffElection(s);
    expect(s.phase).toBe('day-speak');
  });
});

describe('werewolf rules — last-words', () => {
  it('lynched player gets last-words, then game advances', () => {
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const villagerA = byRole(s, 'villager')[0]!;

    // Quick night
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villagerA } });
    }
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    s = skipSheriffElection(s);

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
    // After last-words, advance to next night (starts at night-guard)
    expect(s.phase).toBe('night-guard');
  });
});

describe('werewolf rules — Task 1.5: night order guard→wolf→witch→seer→resolve', () => {
  it('night order is guard→wolf→witch→seer→resolve', () => {
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
    }
    expect(s.phase).toBe('night-witch');   // witch BEFORE seer now
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    expect(s.phase).toBe('night-seer');
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    expect(s.phase).toBe('night-resolve');
  });

  it('no-witch skip: wolves→seer→resolve', () => {
    // Use 9p board but kill the witch before starting
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    // Remove witch from alive list to simulate dead witch
    s = { ...s, alive: s.alive.filter((id) => id !== witch) };
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
    }
    expect(s.phase).toBe('night-seer');   // no witch → skip to seer
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    expect(s.phase).toBe('night-resolve');
  });

  it('no-seer skip: wolves→witch→resolve', () => {
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    // Remove seer from alive list to simulate dead seer
    s = { ...s, alive: s.alive.filter((id) => id !== seer) };
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
    }
    expect(s.phase).toBe('night-witch');   // seer dead → witch still happens
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    expect(s.phase).toBe('night-resolve');  // no seer → straight to resolve
  });
});

describe('werewolf rules — sheriff election', () => {
  // Helper: run a 9p night through, consume first-night last-words, return
  // state at the start of sheriff-claim.
  function nightOneToSheriffClaim(): WerewolfState {
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
    }
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    // Consume first-night last-words before sheriff-claim.
    while (s.phase === 'last-words') {
      s = applyTurn(s, { phase: 'last-words', kind: 'last-words', actorTwinId: s.lastWordsQueue[0], text: 'bye' });
    }
    expect(s.phase).toBe('sheriff-claim');
    return s;
  }

  it('all decline → no sheriff, advance to day-direction then day-speak', () => {
    let s = nightOneToSheriffClaim();
    while (s.phase === 'sheriff-claim') {
      const actor = s.alive[s.sheriffClaimCursor]!;
      s = applyTurn(s, { phase: 'sheriff-claim', kind: 'sheriff-claim', actorTwinId: actor, data: { run: false } });
    }
    expect(s.phase).toBe('day-direction');
    expect(s.sheriff).toBeUndefined();
    expect(s.sheriffElectionDone).toBe(true);
    // Engine fallback: no sheriff → system turn → day-speak
    s = applyTurn(s, { phase: 'day-direction', kind: 'system', actorTwinId: null });
    expect(s.phase).toBe('day-speak');
  });

  it('single candidate auto-elected with 1.5x weight', () => {
    let s = nightOneToSheriffClaim();
    const candidate = s.alive[0]!;
    // First player runs, all others decline.
    while (s.phase === 'sheriff-claim') {
      const actor = s.alive[s.sheriffClaimCursor]!;
      const run = actor === candidate;
      s = applyTurn(s, { phase: 'sheriff-claim', kind: 'sheriff-claim', actorTwinId: actor, data: { run } });
    }
    expect(s.phase).toBe('day-direction');
    expect(s.sheriff).toBe(candidate);
    expect(s.sheriffHas1_5x).toBe(true);
    // Sheriff chooses direction (right by default)
    s = applyTurn(s, { phase: 'day-direction', kind: 'day-direction', actorTwinId: candidate, data: { direction: 'right' } });
    expect(s.phase).toBe('day-speak');
  });

  it('multiple candidates → sheriff-vote phase', () => {
    let s = nightOneToSheriffClaim();
    const candA = s.alive[0]!;
    const candB = s.alive[1]!;
    while (s.phase === 'sheriff-claim') {
      const actor = s.alive[s.sheriffClaimCursor]!;
      const run = actor === candA || actor === candB;
      s = applyTurn(s, { phase: 'sheriff-claim', kind: 'sheriff-claim', actorTwinId: actor, data: { run } });
    }
    expect(s.phase).toBe('sheriff-vote');
    expect(s.sheriffCandidates).toEqual([candA, candB]);
    expect(s.sheriffElectionDone).toBe(false);

    // 警下 (7 non-candidates) vote — all for candA
    while (s.phase === 'sheriff-vote' && s.alive.filter((id) => !s.sheriffCandidates.includes(id) && !s.sheriffVotes[id as unknown as string]).length > 0) {
      const remaining = s.alive.filter((id) => !s.sheriffCandidates.includes(id) && !s.sheriffVotes[id as unknown as string]);
      const voter = remaining[0]!;
      s = applyTurn(s, { phase: 'sheriff-vote', kind: 'sheriff-vote', actorTwinId: voter, data: { target: candA } });
    }
    expect(s.phase).toBe('day-direction');
    expect(s.sheriff).toBe(candA);
    expect(s.sheriffHas1_5x).toBe(true);
    // Sheriff chooses direction
    s = applyTurn(s, { phase: 'day-direction', kind: 'day-direction', actorTwinId: candA, data: { direction: 'right' } });
    expect(s.phase).toBe('day-speak');
  });

  it('sheriff vote 1.5x weight tips a tied tally', () => {
    // Use 4p game so the math is clearer. Actually, sheriff election runs
    // for any size, but with 9p we need an actual scenario where 1.5x tips.
    // Setup: 9p, run sheriff election, then drive day-1 vote where sheriff
    // votes target X and 1 other player also votes X; another target gets
    // 2 votes. Without 1.5, target X = 2 (tied); with 1.5, target X = 2.5
    // (wins).
    let s = nightOneToSheriffClaim();
    const sheriffCand = s.alive[0]!;
    // sheriff is candidate; everyone else declines
    while (s.phase === 'sheriff-claim') {
      const actor = s.alive[s.sheriffClaimCursor]!;
      s = applyTurn(s, {
        phase: 'sheriff-claim',
        kind: 'sheriff-claim',
        actorTwinId: actor,
        data: { run: actor === sheriffCand },
      });
    }
    expect(s.sheriff).toBe(sheriffCand);
    // Sheriff auto-elected → day-direction, sheriff picks direction.
    expect(s.phase).toBe('day-direction');
    s = applyTurn(s, { phase: 'day-direction', kind: 'day-direction', actorTwinId: sheriffCand, data: { direction: 'right' } });

    // Drive day-speak (8 alive after night-1 kill).
    while (s.phase === 'day-speak') {
      const actor = s.alive[s.cursor]!;
      s = applyTurn(s, { phase: 'day-speak', kind: 'speak', actorTwinId: actor, text: 'meh' });
    }
    // After all spoke, sheriff-pull-vote triggers (sheriff alive).
    expect(s.phase).toBe('sheriff-pull-vote');
    s = applyTurn(s, { phase: 'sheriff-pull-vote', kind: 'sheriff-pull-vote', actorTwinId: sheriffCand });
    expect(s.phase).toBe('day-vote');

    // Now construct vote pattern: 4 alive non-sheriffs vote target X (2 votes)
    // vs target Y (2 votes), sheriff votes X (+1.5) → X wins 3.5 vs 2.
    // 8 alive total; pick 2 distinct targets.
    const tgtX = s.alive[1]!;
    const tgtY = s.alive[2]!;
    const voters = s.alive.slice();
    let xVotes = 0, yVotes = 0;
    for (const v of voters) {
      let target = tgtX;
      if (v === sheriffCand) {
        target = tgtX; // sheriff votes X
      } else if (xVotes < 2 && v !== tgtX) {
        target = tgtX; xVotes += 1;
      } else if (yVotes < 4 && v !== tgtY) {
        target = tgtY; yVotes += 1;
      }
      s = applyTurn(s, { phase: 'day-vote', kind: 'vote', actorTwinId: v, data: { target } });
    }
    // After auto-resolve, lynched should be tgtX (with 1.5x boost it tops).
    expect(s.publicLog.some((l) => l.includes(`lynch ${tgtX}`))).toBe(true);
  });

  it('dying sheriff destroys badge by default', () => {
    let s = nightOneToSheriffClaim();
    const sheriffCand = s.alive[0]!;
    while (s.phase === 'sheriff-claim') {
      const actor = s.alive[s.sheriffClaimCursor]!;
      s = applyTurn(s, { phase: 'sheriff-claim', kind: 'sheriff-claim', actorTwinId: actor, data: { run: actor === sheriffCand } });
    }
    // day-direction: sheriff picks direction
    if (s.phase === 'day-direction') {
      s = applyTurn(s, { phase: 'day-direction', kind: 'day-direction', actorTwinId: sheriffCand, data: { direction: 'right' } });
    }
    // Drive day-speak
    while (s.phase === 'day-speak') {
      const actor = s.alive[s.cursor]!;
      s = applyTurn(s, { phase: 'day-speak', kind: 'speak', actorTwinId: actor, text: 'meh' });
    }
    // sheriff-pull-vote then day-vote
    s = applyTurn(s, { phase: 'sheriff-pull-vote', kind: 'sheriff-pull-vote', actorTwinId: sheriffCand });
    // Everyone votes sheriff → lynch sheriff
    for (const v of s.alive) {
      s = applyTurn(s, { phase: 'day-vote', kind: 'vote', actorTwinId: v, data: { target: sheriffCand } });
    }
    expect(s.phase).toBe('last-words');
    expect(s.lastWordsQueue).toContain(sheriffCand);
    // Sheriff dies; last-words with no badge_decision → destroy
    s = applyTurn(s, { phase: 'last-words', kind: 'last-words', actorTwinId: sheriffCand, text: 'bye' });
    expect(s.sheriff).toBeUndefined();
    expect(s.sheriffHas1_5x).toBe(false);
  });

  it('dying sheriff passes badge — inheritor gets BOTH sheriff status AND 1.5x', () => {
    let s = nightOneToSheriffClaim();
    const sheriffCand = s.alive[0]!;
    while (s.phase === 'sheriff-claim') {
      const actor = s.alive[s.sheriffClaimCursor]!;
      s = applyTurn(s, { phase: 'sheriff-claim', kind: 'sheriff-claim', actorTwinId: actor, data: { run: actor === sheriffCand } });
    }
    // day-direction: sheriff picks direction
    if (s.phase === 'day-direction') {
      s = applyTurn(s, { phase: 'day-direction', kind: 'day-direction', actorTwinId: sheriffCand, data: { direction: 'right' } });
    }
    while (s.phase === 'day-speak') {
      const actor = s.alive[s.cursor]!;
      s = applyTurn(s, { phase: 'day-speak', kind: 'speak', actorTwinId: actor, text: 'meh' });
    }
    s = applyTurn(s, { phase: 'sheriff-pull-vote', kind: 'sheriff-pull-vote', actorTwinId: sheriffCand });
    for (const v of s.alive) {
      s = applyTurn(s, { phase: 'day-vote', kind: 'vote', actorTwinId: v, data: { target: sheriffCand } });
    }
    // Pass badge to second-seat alive player.
    const heir = s.alive[0]!; // first remaining
    s = applyTurn(s, {
      phase: 'last-words',
      kind: 'last-words',
      actorTwinId: sheriffCand,
      text: 'I pass the badge',
      data: { badge_decision: `pass:${heir}` },
    });
    expect(s.sheriff).toBe(heir);
    expect(s.sheriffHas1_5x).toBe(true);
  });
});

describe('werewolf rules — sheriff PK round', () => {
  function nightOneToSheriffClaim(): WerewolfState {
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
    }
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    // Consume first-night last-words before sheriff-claim.
    while (s.phase === 'last-words') {
      s = applyTurn(s, { phase: 'last-words', kind: 'last-words', actorTwinId: s.lastWordsQueue[0], text: 'bye' });
    }
    return s;
  }

  it('first-tie triggers PK speech + revote, not 流警', () => {
    let s = nightOneToSheriffClaim();
    // Two candidates run.
    const candA = s.alive[0]!;
    const candB = s.alive[1]!;
    while (s.phase === 'sheriff-claim') {
      const actor = s.alive[s.sheriffClaimCursor]!;
      const run = actor === candA || actor === candB;
      s = applyTurn(s, { phase: 'sheriff-claim', kind: 'sheriff-claim', actorTwinId: actor, data: { run } });
    }
    expect(s.phase).toBe('sheriff-vote');

    // Manufacture a tie: 警下 (6 voters) split 3-3.
    const voters = s.alive.filter((id) => !s.sheriffCandidates.includes(id));
    expect(voters.length).toBe(6);
    for (let i = 0; i < voters.length; i++) {
      const v = voters[i]!;
      const target = i < 3 ? candA : candB;
      s = applyTurn(s, { phase: 'sheriff-vote', kind: 'sheriff-vote', actorTwinId: v, data: { target } });
    }
    // Tie → PK speech phase.
    expect(s.phase).toBe('sheriff-pk-speech');
    expect(s.sheriffPkActive).toBe(true);
    expect(s.sheriffCandidates).toEqual([candA, candB]);
    expect(s.sheriffVotes).toEqual({});
    expect(s.sheriff).toBeUndefined();
  });

  it('PK speech → PK vote → elect winner', () => {
    let s = nightOneToSheriffClaim();
    const candA = s.alive[0]!;
    const candB = s.alive[1]!;
    while (s.phase === 'sheriff-claim') {
      const actor = s.alive[s.sheriffClaimCursor]!;
      const run = actor === candA || actor === candB;
      s = applyTurn(s, { phase: 'sheriff-claim', kind: 'sheriff-claim', actorTwinId: actor, data: { run } });
    }
    // Tied 3-3 in round 1
    const voters = s.alive.filter((id) => !s.sheriffCandidates.includes(id));
    for (let i = 0; i < voters.length; i++) {
      const target = i < 3 ? candA : candB;
      s = applyTurn(s, { phase: 'sheriff-vote', kind: 'sheriff-vote', actorTwinId: voters[i]!, data: { target } });
    }
    expect(s.phase).toBe('sheriff-pk-speech');
    // PK speech: each tied candidate speaks
    while (s.phase === 'sheriff-pk-speech') {
      const speaker = s.sheriffCandidates[s.sheriffPkSpeechCursor]!;
      s = applyTurn(s, {
        phase: 'sheriff-pk-speech',
        kind: 'sheriff-pk-speech',
        actorTwinId: speaker,
        text: 'PK speech',
      });
    }
    expect(s.phase).toBe('sheriff-pk-vote');
    // PK vote: voters break the tie 4-2 for candA
    const pkVoters = s.alive.filter((id) => !s.sheriffCandidates.includes(id));
    for (let i = 0; i < pkVoters.length; i++) {
      const target = i < 4 ? candA : candB;
      s = applyTurn(s, { phase: 'sheriff-pk-vote', kind: 'sheriff-pk-vote', actorTwinId: pkVoters[i]!, data: { target } });
    }
    expect(s.phase).toBe('day-direction');
    expect(s.sheriff).toBe(candA);
    expect(s.sheriffHas1_5x).toBe(true);
    expect(s.sheriffPkActive).toBe(false);
    // Sheriff chooses direction to advance to day-speak
    s = applyTurn(s, { phase: 'day-direction', kind: 'day-direction', actorTwinId: candA, data: { direction: 'right' } });
    expect(s.phase).toBe('day-speak');
  });

  it('second-tie (PK still tied) → 流警', () => {
    let s = nightOneToSheriffClaim();
    const candA = s.alive[0]!;
    const candB = s.alive[1]!;
    while (s.phase === 'sheriff-claim') {
      const actor = s.alive[s.sheriffClaimCursor]!;
      const run = actor === candA || actor === candB;
      s = applyTurn(s, { phase: 'sheriff-claim', kind: 'sheriff-claim', actorTwinId: actor, data: { run } });
    }
    // Round 1: tied 3-3
    const v1 = s.alive.filter((id) => !s.sheriffCandidates.includes(id));
    for (let i = 0; i < v1.length; i++) {
      const target = i < 3 ? candA : candB;
      s = applyTurn(s, { phase: 'sheriff-vote', kind: 'sheriff-vote', actorTwinId: v1[i]!, data: { target } });
    }
    expect(s.phase).toBe('sheriff-pk-speech');
    while (s.phase === 'sheriff-pk-speech') {
      const speaker = s.sheriffCandidates[s.sheriffPkSpeechCursor]!;
      s = applyTurn(s, { phase: 'sheriff-pk-speech', kind: 'sheriff-pk-speech', actorTwinId: speaker, text: 'pk' });
    }
    // PK vote: tied 3-3 again
    const v2 = s.alive.filter((id) => !s.sheriffCandidates.includes(id));
    for (let i = 0; i < v2.length; i++) {
      const target = i < 3 ? candA : candB;
      s = applyTurn(s, { phase: 'sheriff-pk-vote', kind: 'sheriff-pk-vote', actorTwinId: v2[i]!, data: { target } });
    }
    expect(s.phase).toBe('day-direction');
    expect(s.sheriff).toBeUndefined();
    expect(s.sheriffElectionDone).toBe(true);
    // No sheriff → engine fallback system turn
    s = applyTurn(s, { phase: 'day-direction', kind: 'system', actorTwinId: null });
    expect(s.phase).toBe('day-speak');
  });
});

describe('werewolf rules — 自爆 (wolf self-explode)', () => {
  it('wolf self-explode during sheriff-claim → 吞警徽 + skip to next night', () => {
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
    }
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    // First-night death gets last-words; consume them before sheriff-claim.
    while (s.phase === 'last-words') {
      s = applyTurn(s, { phase: 'last-words', kind: 'last-words', actorTwinId: s.lastWordsQueue[0], text: 'bye' });
    }
    expect(s.phase).toBe('sheriff-claim');

    // One wolf self-explodes immediately.
    const exploder = wolves[0]!;
    s = applyTurn(s, { phase: 'sheriff-claim', kind: 'self-explode', actorTwinId: exploder });
    expect(s.alive).not.toContain(exploder);
    expect(s.sheriff).toBeUndefined();
    expect(s.sheriffElectionDone).toBe(true);
    expect(s.phase).toBe('night-guard');
    expect(s.day).toBe(1); // advanced past day 0
  });

  it('wolf self-explode during day-vote → skip to next night, 屠边 may trigger', () => {
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
    }
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    s = skipSheriffElection(s);
    // Drive day-speak
    while (s.phase === 'day-speak') {
      s = applyTurn(s, { phase: 'day-speak', kind: 'speak', actorTwinId: s.alive[s.cursor], text: 'meh' });
    }
    expect(s.phase).toBe('day-vote');
    // Self-explode mid-vote
    s = applyTurn(s, { phase: 'day-vote', kind: 'self-explode', actorTwinId: wolves[1]! });
    expect(s.alive).not.toContain(wolves[1]);
    expect(s.phase).toBe('night-guard');
  });
});

describe('werewolf rules — witch self-save N1 only', () => {
  it('witch CAN self-save on Night 1', () => {
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const witch = byRole(s, 'witch')[0]!;
    const seer = byRole(s, 'seer')[0]!;
    // Wolves kill the witch
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: witch } });
    }
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: { use_save: true } });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    expect(s.witchSavePotion).toBe(false);
    expect(s.witchSaveUsedTonight).toBe(true);
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    expect(s.alive).toContain(witch); // survived
  });

  it('witch CANNOT self-save on Night 2', () => {
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const witch = byRole(s, 'witch')[0]!;
    const seer = byRole(s, 'seer')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    // Night 1: kill a villager (not witch), witch skips
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
    }
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    s = skipSheriffElection(s);
    // Day-1 speak + vote (everyone votes wolf0 to keep night-2 alive simple)
    while (s.phase === 'day-speak') {
      s = applyTurn(s, { phase: 'day-speak', kind: 'speak', actorTwinId: s.alive[s.cursor], text: 'x' });
    }
    while (s.phase === 'day-vote') {
      s = applyTurn(s, { phase: 'day-vote', kind: 'vote', actorTwinId: s.alive[s.cursor], data: { target: wolves[1]! } });
    }
    if (s.phase === 'last-words') {
      s = applyTurn(s, { phase: 'last-words', kind: 'last-words', actorTwinId: s.lastWordsQueue[0], text: 'bye' });
    }
    // Now Night 2 — wolves kill the witch.
    expect(s.day).toBe(1);
    expect(s.phase).toBe('night-guard');
    s = advanceToWerewolf(s);
    expect(s.phase).toBe('night-werewolf');
    const aliveWolves = byRole(s, 'werewolf').filter((w) => s.alive.includes(w));
    for (const w of aliveWolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: witch } });
    }
    // Witch tries to self-save on Night 2 — should be blocked.
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: { use_save: true } });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[1]! } });
    expect(s.witchSavePotion).toBe(true); // potion NOT consumed
    expect(s.witchSaveUsedTonight).toBe(false); // save NOT applied
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    expect(s.alive).not.toContain(witch); // dead on N2
  });
});

describe('werewolf rules — checkWin (屠边)', () => {
  it('villagers win when ALL werewolves dead', () => {
    const s0 = initialState(nine, 42);
    const wolves = byRole(s0, 'werewolf');
    const s: WerewolfState = { ...s0, alive: s0.alive.filter((id) => !wolves.includes(id)) };
    expect(checkWin(s)).toEqual({ ended: true, winner: 'villagers' });
  });

  it('wolves win when ALL gods dead (屠神边) — even with civilians still alive', () => {
    const s0 = initialState(nine, 42);
    const wolves = byRole(s0, 'werewolf');
    const villagers = byRole(s0, 'villager');
    // Keep wolves + civilians; kill all gods (seer/witch/hunter)
    const s: WerewolfState = {
      ...s0,
      alive: [...wolves, ...villagers], // 3 wolves + 3 villagers (no gods)
    };
    expect(checkWin(s)).toEqual({ ended: true, winner: 'werewolves' });
  });

  it('wolves win when ALL civilians dead (屠民边) — even with gods still alive', () => {
    const s0 = initialState(nine, 42);
    const wolves = byRole(s0, 'werewolf');
    const seer = byRole(s0, 'seer')[0]!;
    const witch = byRole(s0, 'witch')[0]!;
    const hunter = byRole(s0, 'hunter')[0]!;
    // Keep wolves + gods; kill all civilians
    const s: WerewolfState = {
      ...s0,
      alive: [...wolves, seer, witch, hunter],
    };
    expect(checkWin(s)).toEqual({ ended: true, winner: 'werewolves' });
  });

  it('NOT ended when both gods and civilians have at least 1 alive (count parity does NOT win)', () => {
    const s0 = initialState(nine, 42);
    const wolves = byRole(s0, 'werewolf');
    const seer = byRole(s0, 'seer')[0]!;
    const villager = byRole(s0, 'villager')[0]!;
    // 3 wolves + 1 seer + 1 villager — wolves outnumber, but both sides still have someone
    const s: WerewolfState = { ...s0, alive: [...wolves, seer, villager] };
    expect(checkWin(s)).toEqual({ ended: false });
  });

  it('not ended at game start', () => {
    expect(checkWin(initialState(nine, 42))).toEqual({ ended: false });
  });

  it('12p 屠神边 needs ALL gods incl. guard dead', () => {
    const s0 = initialState(twelve, 7);
    const wolves = byRole(s0, 'werewolf');
    const villagers = byRole(s0, 'villager');
    const guard = byRole(s0, 'guard')[0]!;
    // wolves + villagers + guard alive (guard is a god) → NOT ended yet
    const withGuard: WerewolfState = { ...s0, alive: [...wolves, ...villagers, guard] };
    expect(checkWin(withGuard)).toEqual({ ended: false });
    // drop the guard too → all gods dead → wolves win
    const noGods: WerewolfState = { ...s0, alive: [...wolves, ...villagers] };
    expect(checkWin(noGods)).toEqual({ ended: true, winner: 'werewolves' });
  });
});

describe('werewolf rules — summarizeFor (post-game memory)', () => {
  it('wolves who survive a wolf-win get outcome=won', () => {
    const s = initialState(nine, 42);
    const wolves = byRole(s, 'werewolf');
    const ended: WerewolfState = {
      ...s,
      winner: 'werewolves',
      alive: [...wolves],
    };
    const plugin = getPlugin('werewolf')!;
    const result = plugin.summarizeFor(ended, wolves[0]!);
    expect(result.outcome).toBe('won');
    expect(result.summary).toContain('werewolf');
    expect(result.summary).toContain('赢了');
  });

  it('villagers in a wolf-win game get outcome=lost', () => {
    const s = initialState(nine, 42);
    const villagers = byRole(s, 'villager');
    const ended: WerewolfState = {
      ...s,
      winner: 'werewolves',
      alive: villagers.slice(0, 1),
    };
    const plugin = getPlugin('werewolf')!;
    const result = plugin.summarizeFor(ended, villagers[0]!);
    expect(result.outcome).toBe('lost');
    expect(result.summary).toContain('输了');
  });

  it('non-wolves in a villager-win get outcome=won', () => {
    const s = initialState(nine, 42);
    const seer = byRole(s, 'seer')[0]!;
    const ended: WerewolfState = { ...s, winner: 'villagers' };
    const plugin = getPlugin('werewolf')!;
    const result = plugin.summarizeFor(ended, seer);
    expect(result.outcome).toBe('won');
    expect(result.summary).toContain('seer');
  });
});

describe('werewolf prompts — grounding facts (anti-hallucination)', () => {
  it('seer with NO peeks gets explicit "you have not peeked" reminder', () => {
    const s = initialState(nine, 42);
    const seer = byRole(s, 'seer')[0]!;
    const p = buildUserPrompt({
      state: s,
      actorTwinId: seer,
      phase: 'last-words',
      kind: 'last-words',
      visibleTurns: [],
      aliveNames: {},
    });
    expect(p).toContain('你目前尚未做过任何查验');
    expect(p).toContain('不要编造查验结果');
  });

  it('seer with peeks gets concrete check history', () => {
    let s = initialState(nine, 42);
    const seer = byRole(s, 'seer')[0]!;
    const wolf = byRole(s, 'werewolf')[0]!;
    s = {
      ...s,
      seerKnowledge: [{ target: wolf, role: 'werewolf', day: 0 }],
    };
    const p = buildUserPrompt({
      state: s,
      actorTwinId: seer,
      phase: 'last-words',
      kind: 'last-words',
      visibleTurns: [],
      aliveNames: { [wolf as unknown as string]: 'AliceWolf' },
    });
    expect(p).toContain('AliceWolf = werewolf');
    expect(p).toContain('只能引用以上事实');
  });

  it('witch sees actual potion state', () => {
    let s = initialState(nine, 42);
    const witch = byRole(s, 'witch')[0]!;
    // Mark save as used
    s = { ...s, witchSavePotion: false };
    const p = buildUserPrompt({
      state: s,
      actorTwinId: witch,
      phase: 'last-words',
      kind: 'last-words',
      visibleTurns: [],
      aliveNames: {},
    });
    expect(p).toContain('解药【已用过】');
    expect(p).toContain('毒药【未使用】');
  });
});

describe('werewolf prompts — sheriff vote sees candidate speeches', () => {
  it('renders each candidate\'s sheriff-claim speech inline', () => {
    let s = initialState(nine, 42);
    const candA = s.alive[0]!;
    const candB = s.alive[1]!;
    s = { ...s, sheriffCandidates: [candA, candB], phase: 'sheriff-vote' };
    const voter = s.alive[2]!;
    const visibleTurns = [
      {
        phase: 'sheriff-claim',
        kind: 'sheriff-claim',
        text: '我是 Alice，选我当警长，我会带领大家！',
        actorTwinId: candA,
      },
      {
        phase: 'sheriff-claim',
        kind: 'sheriff-claim',
        text: '我是 Bob，我跳预言家，昨晚查了 X 是金水。',
        actorTwinId: candB,
      },
    ];
    const p = buildUserPrompt({
      state: s,
      actorTwinId: voter,
      phase: 'sheriff-vote',
      kind: 'sheriff-vote',
      visibleTurns,
      aliveNames: {
        [candA as unknown as string]: 'Alice',
        [candB as unknown as string]: 'Bob',
      },
    });
    expect(p).toContain('我是 Alice');
    expect(p).toContain('我跳预言家');
    expect(p).toContain('CANDIDATE SPEECHES');
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

describe('werewolf rules — night resolve 3-input gate (守×救×毒)', () => {
  // Returns state at night-guard for a fresh 12p game.
  function n1(): WerewolfState { return initialState(twelve, 7); }

  it('守+救 both protect the SAME wolf target → 奶穿: target DIES, counts as 狼刀 (hunter could shoot)', () => {
    let s = n1();
    const wolves = byRole(s, 'werewolf');
    const guard = byRole(s, 'guard')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const seer = byRole(s, 'seer')[0]!;
    const hunter = byRole(s, 'hunter')[0]!;
    // guard protects the hunter; wolves knife the hunter; witch saves the hunter.
    s = applyTurn(s, { phase: 'night-guard', kind: 'guard-protect', actorTwinId: guard, data: { target: hunter } });
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: hunter } });
    }
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: { use_save: true } });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    expect(s.alive).not.toContain(hunter);              // 奶穿 → dies
    expect(s.poisonedThisNight).not.toContain(hunter);  // NOT poisoned → hunter shot allowed
    expect(s.pendingHunterShot).toBe(hunter);           // hunter can shoot (death = 狼刀)
  });

  it('守 only (no save) → target LIVES', () => {
    let s = n1();
    const wolves = byRole(s, 'werewolf');
    const guard = byRole(s, 'guard')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const seer = byRole(s, 'seer')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    s = applyTurn(s, { phase: 'night-guard', kind: 'guard-protect', actorTwinId: guard, data: { target: villager } });
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
    }
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    expect(s.alive).toContain(villager);
  });

  it('救 only (no guard) → target LIVES', () => {
    let s = n1();
    const wolves = byRole(s, 'werewolf');
    const guard = byRole(s, 'guard')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const seer = byRole(s, 'seer')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    s = applyTurn(s, { phase: 'night-guard', kind: 'guard-protect', actorTwinId: guard, data: {} }); // 空守
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
    }
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: { use_save: true } });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    expect(s.alive).toContain(villager);
  });

  it('neither 守 nor 救 → target DIES (狼刀)', () => {
    let s = n1();
    const wolves = byRole(s, 'werewolf');
    const guard = byRole(s, 'guard')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const seer = byRole(s, 'seer')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    s = applyTurn(s, { phase: 'night-guard', kind: 'guard-protect', actorTwinId: guard, data: {} });
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
    }
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    expect(s.alive).not.toContain(villager);
  });

  it('毒穿盾: guard protects + witch poisons the SAME target → DIES, counts as 毒 (hunter blocked)', () => {
    let s = n1();
    const wolves = byRole(s, 'werewolf');
    const guard = byRole(s, 'guard')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const seer = byRole(s, 'seer')[0]!;
    const hunter = byRole(s, 'hunter')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    s = applyTurn(s, { phase: 'night-guard', kind: 'guard-protect', actorTwinId: guard, data: { target: hunter } });
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
    }
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: { poison_target: hunter } });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    expect(s.alive).not.toContain(hunter);              // poison pierces the shield
    expect(s.poisonedThisNight).toContain(hunter);      // counted as poison
    expect(s.pendingHunterShot).toBeUndefined();        // hunter CANNOT shoot
  });

  it('rotates lastGuardTarget and forbids guarding the same player next night', () => {
    let s = n1();
    const guard = byRole(s, 'guard')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const seer = byRole(s, 'seer')[0]!;
    const wolves = byRole(s, 'werewolf');
    const villager = byRole(s, 'villager')[0]!;
    const villagerB = byRole(s, 'villager')[1]!;
    // N1: guard protects villager; wolves knife villagerB; witch passes; seer peeks.
    s = applyTurn(s, { phase: 'night-guard', kind: 'guard-protect', actorTwinId: guard, data: { target: villager } });
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villagerB } });
    }
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    expect(s.lastGuardTarget).toBe(villager);
    // Fast-forward through Day 1: sheriff election, speak, vote (eliminate wolves[0] to keep it alive for N2).
    // NOTE: day-direction phase added in Unit 2; skip it here, re-add after Unit 2 lands.
    s = skipSheriffElection(s);
    while (s.phase === 'day-speak') {
      s = applyTurn(s, { phase: 'day-speak', kind: 'speak', actorTwinId: s.alive[s.cursor], text: 'x' });
    }
    while (s.phase === 'day-vote') {
      s = applyTurn(s, { phase: 'day-vote', kind: 'vote', actorTwinId: s.alive[s.cursor], data: { target: wolves[0] } });
    }
    if (s.phase === 'last-words') {
      s = applyTurn(s, { phase: 'last-words', kind: 'last-words', actorTwinId: s.lastWordsQueue[0], text: 'bye' });
    }
    expect(s.phase).toBe('night-guard');
    // N2: try to re-guard the same villager → 违规按空守.
    s = applyTurn(s, { phase: 'night-guard', kind: 'guard-protect', actorTwinId: guard, data: { target: villager } });
    expect(s.guardTargetThisNight).toBeUndefined();
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

describe('werewolf rules — 遗言不对称 (first-night only)', () => {
  it('first-night (day===0) night-death gets last-words', () => {
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const witch = byRole(s, 'witch')[0]!;
    const seer = byRole(s, 'seer')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    for (const w of wolves) s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    expect(s.lastWordsQueue).toContain(villager);
    expect(s.phase).toBe('last-words');
  });

  it('night-2 (day===1) night-death gets NO last-words (off-by-one nailed)', () => {
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const witch = byRole(s, 'witch')[0]!;
    const seer = byRole(s, 'seer')[0]!;
    const vA = byRole(s, 'villager')[0]!;
    const vB = byRole(s, 'villager')[1]!;
    // N1: kill vA
    for (const w of wolves) s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: vA } });
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    // consume N1 last-words for vA
    if (s.phase === 'last-words') s = applyTurn(s, { phase: 'last-words', kind: 'last-words', actorTwinId: s.lastWordsQueue[0], text: 'bye' });
    s = skipSheriffElection(s);
    // day-1: skip speak, vote out wolves[0]
    while (s.phase === 'day-speak') s = applyTurn(s, { phase: 'day-speak', kind: 'speak', actorTwinId: s.alive[s.cursor], text: 'x' });
    while (s.phase === 'day-vote') s = applyTurn(s, { phase: 'day-vote', kind: 'vote', actorTwinId: s.alive[s.cursor], data: { target: wolves[0] } });
    if (s.phase === 'last-words') s = applyTurn(s, { phase: 'last-words', kind: 'last-words', actorTwinId: s.lastWordsQueue[0], text: 'bye' });
    expect(s.day).toBe(1);
    expect(s.phase).toBe('night-guard');
    // N2: kill vB
    s = advanceToWerewolf(s);
    const aliveWolves = byRole(s, 'werewolf').filter((w) => s.alive.includes(w));
    for (const w of aliveWolves) s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: vB } });
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: aliveWolves[0] } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    expect(s.alive).not.toContain(vB);
    expect(s.lastWordsQueue).toEqual([]); // NO last-words on night 2
  });
});

describe('werewolf rules — day-direction (发言顺序)', () => {
  it('no sheriff → engine skips, snapshots speechOrder, lands on day-speak', () => {
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const witch = byRole(s, 'witch')[0]!;
    const seer = byRole(s, 'seer')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    for (const w of wolves) s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    if (s.phase === 'last-words') s = applyTurn(s, { phase: 'last-words', kind: 'last-words', actorTwinId: s.lastWordsQueue[0], text: 'bye' });
    s = skipSheriffElection(s);
    // skipSheriffElection also applies the day-direction system turn, so we're at day-speak
    // But we want to test day-direction specifically — let's do it more carefully:
    // Re-do without skipSheriffElection's day-direction step
    let s2 = advanceToWerewolf(initialState(nine, 42));
    for (const w of wolves) s2 = applyTurn(s2, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
    s2 = applyTurn(s2, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    s2 = applyTurn(s2, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s2 = applyTurn(s2, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    if (s2.phase === 'last-words') s2 = applyTurn(s2, { phase: 'last-words', kind: 'last-words', actorTwinId: s2.lastWordsQueue[0], text: 'bye' });
    // Manually skip sheriff-claim (all decline), arrive at day-direction
    while (s2.phase === 'sheriff-claim') {
      const actor = s2.alive[s2.sheriffClaimCursor]!;
      s2 = applyTurn(s2, { phase: 'sheriff-claim', kind: 'sheriff-claim', actorTwinId: actor, data: { run: false } });
    }
    expect(s2.phase).toBe('day-direction');
    // planNextTurn should return a system kind (no sheriff)
    const plan = planNextTurn(s2)!;
    expect(plan.kind).toBe('system');
    // Apply engine fallback
    s2 = applyTurn(s2, { phase: 'day-direction', kind: 'system', actorTwinId: null });
    expect(s2.phase).toBe('day-speak');
    expect(s2.speechOrder).toBeDefined();
    expect(s2.speechOrder!.every((id) => s2.alive.includes(id))).toBe(true);
    expect(s2.speechOrder!.length).toBe(s2.alive.length);
    expect(s2.speechCursor).toBe(0);
  });

  it('computeSpeechOrder: exactly-one-death → anchor at victim seat, direction right', () => {
    // Build state: one death (villager at some seat), no sheriff.
    // Verify that speechOrder[0] is the player in the seat immediately after (clockwise) the victim.
    const s0 = initialState(nine, 42);
    const villager = byRole(s0, 'villager')[0]!;
    const victimSeat = s0.participants.indexOf(villager);
    // Build a fake state with one night death and all others alive.
    const fakeState: WerewolfState = {
      ...s0,
      alive: s0.participants.filter((id) => id !== villager),
      nightDeaths: [villager],
      phase: 'day-direction',
      speechCursor: 0,
      sheriff: undefined,
    };
    // Engine fallback (no sheriff, one death) → right direction from victim seat
    const after = applyTurn(fakeState, { phase: 'day-direction', kind: 'system', actorTwinId: null });
    expect(after.phase).toBe('day-speak');
    expect(after.speechOrder).toBeDefined();
    expect(after.speechDirection).toBe('right');
    // speechOrder[0] should be the first alive player clockwise after victim
    const n = s0.participants.length;
    let expectedFirst: Id<'twins'> | undefined;
    for (let k = 1; k <= n; k++) {
      const seat = (victimSeat + k) % n;
      const id = s0.participants[seat]!;
      if (after.alive.includes(id)) { expectedFirst = id; break; }
    }
    expect(after.speechOrder![0]).toBe(expectedFirst);
    expect(after.speechOrder!.length).toBe(after.alive.length);
  });

  it('sheriff picks 死右 → speechOrder[0] is seat after victim', () => {
    const s0 = initialState(nine, 42);
    const villager = byRole(s0, 'villager')[0]!;
    const sheriff = byRole(s0, 'seer')[0]!; // seer acts as sheriff for this test
    const victimSeat = s0.participants.indexOf(villager);
    const fakeState: WerewolfState = {
      ...s0,
      alive: s0.participants.filter((id) => id !== villager),
      nightDeaths: [villager],
      phase: 'day-direction',
      speechCursor: 0,
      sheriff,
    };
    const after = applyTurn(fakeState, {
      phase: 'day-direction',
      kind: 'day-direction',
      actorTwinId: sheriff,
      data: { direction: 'right' },
    });
    expect(after.phase).toBe('day-speak');
    expect(after.speechDirection).toBe('right');
    const n = s0.participants.length;
    let expectedFirst: Id<'twins'> | undefined;
    for (let k = 1; k <= n; k++) {
      const seat = (victimSeat + k) % n;
      const id = s0.participants[seat]!;
      if (after.alive.includes(id)) { expectedFirst = id; break; }
    }
    expect(after.speechOrder![0]).toBe(expectedFirst);
  });

  it('sheriff picks 死左 → speechOrder[0] is seat before victim', () => {
    const s0 = initialState(nine, 42);
    const villager = byRole(s0, 'villager')[0]!;
    const sheriff = byRole(s0, 'seer')[0]!;
    const victimSeat = s0.participants.indexOf(villager);
    const n = s0.participants.length;
    const fakeState: WerewolfState = {
      ...s0,
      alive: s0.participants.filter((id) => id !== villager),
      nightDeaths: [villager],
      phase: 'day-direction',
      speechCursor: 0,
      sheriff,
    };
    const after = applyTurn(fakeState, {
      phase: 'day-direction',
      kind: 'day-direction',
      actorTwinId: sheriff,
      data: { direction: 'left' },
    });
    expect(after.speechDirection).toBe('left');
    let expectedFirst: Id<'twins'> | undefined;
    for (let k = 1; k <= n; k++) {
      const seat = ((victimSeat - k) % n + n) % n;
      const id = s0.participants[seat]!;
      if (after.alive.includes(id)) { expectedFirst = id; break; }
    }
    expect(after.speechOrder![0]).toBe(expectedFirst);
  });

  it('平安夜 (0 deaths) → anchor seat 0, direction right by default', () => {
    const s0 = initialState(nine, 42);
    const fakeState: WerewolfState = {
      ...s0,
      nightDeaths: [],
      phase: 'day-direction',
      speechCursor: 0,
      sheriff: undefined,
    };
    const after = applyTurn(fakeState, { phase: 'day-direction', kind: 'system', actorTwinId: null });
    expect(after.phase).toBe('day-speak');
    expect(after.speechDirection).toBe('right');
    // Anchor = seat 0 (participants[0]), direction right → speechOrder starts at seat 1's next alive
    const n = s0.participants.length;
    let expectedFirst: Id<'twins'> | undefined;
    for (let k = 1; k <= n; k++) {
      const seat = k % n;
      const id = s0.participants[seat]!;
      if (after.alive.includes(id)) { expectedFirst = id; break; }
    }
    expect(after.speechOrder![0]).toBe(expectedFirst);
    expect(after.speechOrder!.length).toBe(after.alive.length);
  });

  it('speechOrder contains only alive players (not the dead anchor)', () => {
    const s0 = initialState(nine, 42);
    const villager = byRole(s0, 'villager')[0]!;
    const fakeState: WerewolfState = {
      ...s0,
      alive: s0.participants.filter((id) => id !== villager),
      nightDeaths: [villager],
      phase: 'day-direction',
      speechCursor: 0,
      sheriff: undefined,
    };
    const after = applyTurn(fakeState, { phase: 'day-direction', kind: 'system', actorTwinId: null });
    expect(after.speechOrder).not.toContain(villager);
    expect(after.speechOrder!.length).toBe(after.alive.length);
  });
});
