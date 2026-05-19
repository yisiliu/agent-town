import type { Id } from '../../../_generated/dataModel';
import type { AppliedTurn, TurnPlan } from '../types';
import type {
  HiddenMind,
  WerewolfPhase,
  WerewolfRole,
  WerewolfState,
} from './state';

// Mulberry32 — small deterministic PRNG; sufficient for role shuffles +
// hidden-trait sampling.
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

function clone(s: WerewolfState): WerewolfState {
  return {
    participants: s.participants.slice(),
    roles: { ...s.roles },
    alive: s.alive.slice(),
    hiddenMinds: { ...s.hiddenMinds },
    phase: s.phase,
    wolfVotes: { ...s.wolfVotes },
    pendingWolfKill: s.pendingWolfKill,
    witchSaveUsedTonight: s.witchSaveUsedTonight,
    pendingPoisonTarget: s.pendingPoisonTarget,
    witchSavePotion: s.witchSavePotion,
    witchPoisonPotion: s.witchPoisonPotion,
    nightDeaths: s.nightDeaths.slice(),
    poisonedThisNight: s.poisonedThisNight.slice(),
    lastWordsQueue: s.lastWordsQueue.slice(),
    pendingHunterShot: s.pendingHunterShot,
    phaseAfterHunterShot: s.phaseAfterHunterShot,
    sheriff: s.sheriff,
    sheriffHas1_5x: s.sheriffHas1_5x,
    sheriffCandidates: s.sheriffCandidates.slice(),
    sheriffClaimCursor: s.sheriffClaimCursor,
    sheriffVotes: { ...s.sheriffVotes },
    sheriffElectionDone: s.sheriffElectionDone,
    cursor: s.cursor,
    pendingVotes: { ...s.pendingVotes },
    publicLog: s.publicLog.slice(),
    seerKnowledge: s.seerKnowledge.slice(),
    day: s.day,
    winner: s.winner,
  };
}

function asKey(id: Id<'twins'>): string {
  return id as unknown as string;
}

// 9-player canonical config. The wolfcha codebase calls this "3+SWH+3民".
// Other player counts get nearest-canonical assignments; v1 only targets 9.
function assignRoles(
  shuffled: Id<'twins'>[],
): Record<string, WerewolfRole> {
  const roles: Record<string, WerewolfRole> = {};
  const n = shuffled.length;

  if (n === 9) {
    // 3 wolves, 1 seer, 1 witch, 1 hunter, 3 villagers
    roles[asKey(shuffled[0]!)] = 'werewolf';
    roles[asKey(shuffled[1]!)] = 'werewolf';
    roles[asKey(shuffled[2]!)] = 'werewolf';
    roles[asKey(shuffled[3]!)] = 'seer';
    roles[asKey(shuffled[4]!)] = 'witch';
    roles[asKey(shuffled[5]!)] = 'hunter';
    for (let i = 6; i < n; i++) roles[asKey(shuffled[i]!)] = 'villager';
    return roles;
  }

  // Fallback for smaller games (≥4): scale werewolves to floor(n/4), keep
  // seer + witch when n≥6, hunter when n≥7, rest villagers.
  const wolves = Math.max(1, Math.floor(n / 4));
  let i = 0;
  for (let w = 0; w < wolves; w++) roles[asKey(shuffled[i++]!)] = 'werewolf';
  if (i < n) roles[asKey(shuffled[i++]!)] = 'seer';
  if (n >= 6 && i < n) roles[asKey(shuffled[i++]!)] = 'witch';
  if (n >= 7 && i < n) roles[asKey(shuffled[i++]!)] = 'hunter';
  while (i < n) roles[asKey(shuffled[i++]!)] = 'villager';
  return roles;
}

function sampleHiddenMind(rand: () => number): HiddenMind {
  const pick = () => 1 + Math.floor(rand() * 5); // 1..5
  return {
    courage: pick(),
    suspicion_threshold: pick(),
    self_preservation: pick(),
    logic: pick(),
    table_presence: pick(),
  };
}

export function initialState(
  participants: Id<'twins'>[],
  seed: number,
): WerewolfState {
  if (participants.length < 4) {
    throw new Error(`werewolf needs ≥4 players, got ${participants.length}`);
  }
  const rand = mulberry32(seed);
  const shuffled = shuffle(participants, rand);
  const roles = assignRoles(shuffled);
  const hiddenMinds: Record<string, HiddenMind> = {};
  for (const id of participants) {
    hiddenMinds[asKey(id)] = sampleHiddenMind(rand);
  }
  return {
    participants: participants.slice(),
    roles,
    alive: participants.slice(),
    hiddenMinds,
    phase: 'night-werewolf',
    wolfVotes: {},
    pendingWolfKill: undefined,
    witchSaveUsedTonight: false,
    pendingPoisonTarget: undefined,
    witchSavePotion: true,
    witchPoisonPotion: true,
    nightDeaths: [],
    poisonedThisNight: [],
    lastWordsQueue: [],
    pendingHunterShot: undefined,
    phaseAfterHunterShot: undefined,
    sheriff: undefined,
    sheriffHas1_5x: false,
    sheriffCandidates: [],
    sheriffClaimCursor: 0,
    sheriffVotes: {},
    sheriffElectionDone: false,
    cursor: 0,
    pendingVotes: {},
    publicLog: [`Day 0: Game begins with ${participants.length} players.`],
    seerKnowledge: [],
    day: 0,
  };
}

function aliveByRole(s: WerewolfState, role: WerewolfRole): Id<'twins'>[] {
  return s.alive.filter((id) => s.roles[asKey(id)] === role);
}

export function checkWin(s: WerewolfState): { ended: boolean; winner?: string } {
  const wolves = aliveByRole(s, 'werewolf');
  if (wolves.length === 0) return { ended: true, winner: 'villagers' };
  const nonWolves = s.alive.length - wolves.length;
  if (wolves.length >= nonWolves) return { ended: true, winner: 'werewolves' };
  return { ended: false };
}

// Decide the next phase after a resolve / death event.
function transitionAfterResolve(s: WerewolfState, fromNightResolve: boolean): WerewolfState {
  const next = clone(s);
  const win = checkWin(next);
  if (win.ended) {
    next.phase = 'ended';
    next.winner = win.winner as 'werewolves' | 'villagers';
    return next;
  }
  if (next.pendingHunterShot) {
    next.phase = 'hunter-shoot';
    return next;
  }
  if (next.lastWordsQueue.length > 0) {
    next.phase = 'last-words';
    return next;
  }
  if (fromNightResolve) {
    // Day-1 morning: run sheriff election before day-speak.
    if (!next.sheriffElectionDone) {
      next.phase = 'sheriff-claim';
      next.sheriffClaimCursor = 0;
      next.cursor = 0;
      return next;
    }
    next.phase = 'day-speak';
    next.cursor = 0;
  } else {
    // From day-resolve: start a new night.
    next.phase = 'night-werewolf';
    next.cursor = 0;
    next.day += 1;
    next.wolfVotes = {};
    next.pendingWolfKill = undefined;
    next.pendingPoisonTarget = undefined;
    next.witchSaveUsedTonight = false;
    next.nightDeaths = [];
    next.poisonedThisNight = [];
  }
  return next;
}

// ---- planNextTurn ---------------------------------------------------------

export function planNextTurn(s: WerewolfState): TurnPlan | null {
  if (s.phase === 'ended') return null;

  if (s.phase === 'night-werewolf') {
    const wolves = aliveByRole(s, 'werewolf');
    const unvoted = wolves.filter((id) => !s.wolfVotes[asKey(id)]);
    const next = unvoted[0];
    if (!next) {
      // All wolves voted — applyTurn should have transitioned already.
      // Defensive fallback: emit a system turn to nudge state forward.
      return {
        phase: 'night-werewolf',
        kind: 'system',
        actorTwinId: null,
        visibility: 'public',
        systemText: 'Wolves finalize their choice.',
      };
    }
    return {
      phase: 'night-werewolf',
      kind: 'wolf-kill-bid',
      actorTwinId: next,
      // Simultaneous-bid semantics: each wolf's bid is visible ONLY to that
      // wolf. Other wolves don't see prior bids when forming their own
      // choice, so the team decision is "together without prior knowledge"
      // (the LLM picks independently; the framework collects + tallies).
      visibility: [next],
    };
  }

  if (s.phase === 'night-seer') {
    const seer = aliveByRole(s, 'seer')[0];
    if (!seer) {
      return { phase: 'night-seer', kind: 'system', actorTwinId: null, visibility: 'public', systemText: 'No seer to peek tonight.' };
    }
    return { phase: 'night-seer', kind: 'peek', actorTwinId: seer, visibility: [seer] };
  }

  if (s.phase === 'night-witch') {
    const witch = aliveByRole(s, 'witch')[0];
    if (!witch) {
      return { phase: 'night-witch', kind: 'system', actorTwinId: null, visibility: 'public', systemText: 'No witch to act tonight.' };
    }
    return { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, visibility: [witch] };
  }

  if (s.phase === 'night-resolve') {
    return { phase: 'night-resolve', kind: 'system', actorTwinId: null, visibility: 'public', systemText: 'The night ends; the village wakes.' };
  }

  if (s.phase === 'sheriff-claim') {
    const actor = s.alive[s.sheriffClaimCursor];
    if (!actor) {
      // No alive players? Defensive.
      return null;
    }
    return { phase: 'sheriff-claim', kind: 'sheriff-claim', actorTwinId: actor, visibility: 'public' };
  }

  if (s.phase === 'sheriff-vote') {
    // Only 警下 (non-candidates) vote. Find the next non-candidate who
    // hasn't voted yet.
    const remainingVoters = s.alive.filter(
      (id) => !s.sheriffCandidates.includes(id) && !s.sheriffVotes[asKey(id)],
    );
    const actor = remainingVoters[0];
    if (!actor) {
      // No remaining voters — election resolves in applyTurn after the last
      // vote. Defensive system turn.
      return { phase: 'sheriff-vote', kind: 'system', actorTwinId: null, visibility: 'public', systemText: 'Sheriff election ends.' };
    }
    return { phase: 'sheriff-vote', kind: 'sheriff-vote', actorTwinId: actor, visibility: 'public' };
  }

  if (s.phase === 'sheriff-pull-vote') {
    if (!s.sheriff) {
      // No sheriff → skip directly to day-vote.
      return { phase: 'sheriff-pull-vote', kind: 'system', actorTwinId: null, visibility: 'public', systemText: 'No sheriff to pull-vote.' };
    }
    return { phase: 'sheriff-pull-vote', kind: 'sheriff-pull-vote', actorTwinId: s.sheriff, visibility: 'public' };
  }

  if (s.phase === 'hunter-shoot') {
    const hunter = s.pendingHunterShot;
    if (!hunter) {
      return { phase: 'hunter-shoot', kind: 'system', actorTwinId: null, visibility: 'public', systemText: 'No hunter pending.' };
    }
    return { phase: 'hunter-shoot', kind: 'hunter-shoot', actorTwinId: hunter, visibility: 'public' };
  }

  if (s.phase === 'last-words') {
    const speaker = s.lastWordsQueue[0];
    if (!speaker) {
      return { phase: 'last-words', kind: 'system', actorTwinId: null, visibility: 'public', systemText: 'No one to speak.' };
    }
    return { phase: 'last-words', kind: 'last-words', actorTwinId: speaker, visibility: 'public' };
  }

  if (s.phase === 'day-speak') {
    const actor = s.alive[s.cursor];
    if (!actor) return null;
    return { phase: 'day-speak', kind: 'speak', actorTwinId: actor, visibility: 'public' };
  }

  if (s.phase === 'day-vote') {
    const actor = s.alive[s.cursor];
    if (!actor) return null;
    return { phase: 'day-vote', kind: 'vote', actorTwinId: actor, visibility: 'public' };
  }

  if (s.phase === 'day-resolve') {
    return { phase: 'day-resolve', kind: 'system', actorTwinId: null, visibility: 'public', systemText: 'The village tallies votes.' };
  }

  return null;
}

// ---- applyTurn ------------------------------------------------------------

function collapseWolfVotes(s: WerewolfState): Id<'twins'> | undefined {
  const tally: Record<string, number> = {};
  for (const target of Object.values(s.wolfVotes)) {
    tally[target] = (tally[target] || 0) + 1;
  }
  let max = 0;
  const leaders: string[] = [];
  for (const [target, n] of Object.entries(tally)) {
    if (n > max) {
      max = n;
      leaders.length = 0;
      leaders.push(target);
    } else if (n === max) {
      leaders.push(target);
    }
  }
  if (leaders.length === 0) return undefined;
  if (leaders.length === 1) {
    return leaders[0] as unknown as Id<'twins'>;
  }
  // Tie → vote from the lowest-seat alive wolf wins.
  const aliveWolves = aliveByRole(s, 'werewolf');
  for (const w of aliveWolves) {
    const choice = s.wolfVotes[asKey(w)];
    if (choice && leaders.includes(choice)) {
      return choice as unknown as Id<'twins'>;
    }
  }
  return leaders[0] as unknown as Id<'twins'>;
}

function applyNightResolve(s: WerewolfState): WerewolfState {
  const next = clone(s);
  const deaths: Id<'twins'>[] = [];

  // Wolf kill (unless saved by witch).
  if (next.pendingWolfKill && !next.witchSaveUsedTonight) {
    deaths.push(next.pendingWolfKill);
  }
  // Witch poison.
  if (next.pendingPoisonTarget) {
    deaths.push(next.pendingPoisonTarget);
    next.poisonedThisNight.push(next.pendingPoisonTarget);
  }

  // Dedup (witch can't poison the same target wolves already killed — but
  // if they coincidentally pick the same target, count once).
  const seen = new Set<string>();
  const uniqDeaths: Id<'twins'>[] = [];
  for (const d of deaths) {
    const k = asKey(d);
    if (!seen.has(k)) {
      seen.add(k);
      uniqDeaths.push(d);
    }
  }

  // Apply: remove from alive, log, queue hunter-shoot if applicable.
  for (const d of uniqDeaths) {
    next.alive = next.alive.filter((id) => id !== d);
    next.publicLog.push(
      `Day ${next.day + 1}: ${d} was found dead in the night.`,
    );
    if (next.roles[asKey(d)] === 'hunter') {
      const poisoned = next.poisonedThisNight.includes(d);
      if (!poisoned && !next.pendingHunterShot) {
        next.pendingHunterShot = d;
        // Night death → after the shot, return to day-speak (the village
        // still needs to discuss and lynch).
        next.phaseAfterHunterShot = 'day-speak';
      }
    }
  }

  if (uniqDeaths.length === 0) {
    next.publicLog.push(
      `Day ${next.day + 1}: The village wakes unharmed; no one died.`,
    );
  }

  next.pendingWolfKill = undefined;
  next.pendingPoisonTarget = undefined;
  next.witchSaveUsedTonight = false;
  next.nightDeaths = uniqDeaths;
  return transitionAfterResolve(next, true);
}

function applyDayResolve(s: WerewolfState): WerewolfState {
  const next = clone(s);
  const tally: Record<string, number> = {};
  for (const [voterId, target] of Object.entries(next.pendingVotes)) {
    // Sheriff who still holds the original badge gets 1.5x weight.
    const weight =
      next.sheriff && asKey(next.sheriff) === voterId && next.sheriffHas1_5x
        ? 1.5
        : 1.0;
    tally[target] = (tally[target] || 0) + weight;
  }
  let max = 0;
  let winner: string | null = null;
  let tied = false;
  for (const [target, n] of Object.entries(tally)) {
    if (n > max) {
      max = n;
      winner = target;
      tied = false;
    } else if (n === max) {
      tied = true;
    }
  }
  next.pendingVotes = {};

  if (winner && !tied && max > 0) {
    const lynched = winner as unknown as Id<'twins'>;
    next.alive = next.alive.filter((id) => id !== lynched);
    next.publicLog.push(
      `Day ${next.day + 1}: The village voted to lynch ${winner}.`,
    );
    // Lynched player gets last-words.
    next.lastWordsQueue.push(lynched);
    // Hunter shoots on lynch too (not blocked by poison — they weren't poisoned in this case).
    if (next.roles[asKey(lynched)] === 'hunter') {
      next.pendingHunterShot = lynched;
      // Day-lynch → after the shot, advance to next night.
      next.phaseAfterHunterShot = 'night-werewolf';
    }
    // If the lynched player is the sheriff, the badge decision happens in
    // their last-words turn. The badge defaults to destroyed if they don't
    // explicitly pass (handled in the last-words applyTurn).
  } else {
    next.publicLog.push(
      `Day ${next.day + 1}: The village deadlocked — no one was lynched.`,
    );
  }

  return transitionAfterResolve(next, false);
}

export function applyTurn(s: WerewolfState, t: AppliedTurn): WerewolfState {
  // ---- night-werewolf-bid ----
  if (s.phase === 'night-werewolf' && (t.kind === 'wolf-kill-bid' || t.kind === 'abstain')) {
    const next = clone(s);
    if (t.kind === 'wolf-kill-bid' && t.actorTwinId) {
      const target = (t.data as { target?: Id<'twins'> })?.target;
      if (target && next.alive.includes(target) && next.roles[asKey(t.actorTwinId)] === 'werewolf') {
        next.wolfVotes[asKey(t.actorTwinId)] = asKey(target);
      }
    }
    // After each bid, check if all alive wolves have voted.
    const aliveWolves = aliveByRole(next, 'werewolf');
    const allVoted = aliveWolves.every((id) => next.wolfVotes[asKey(id)]);
    if (allVoted) {
      next.pendingWolfKill = collapseWolfVotes(next);
      next.wolfVotes = {};
      // Pick next sub-phase. Seer → Witch → Resolve.
      if (aliveByRole(next, 'seer').length > 0) next.phase = 'night-seer';
      else if (aliveByRole(next, 'witch').length > 0) next.phase = 'night-witch';
      else next.phase = 'night-resolve';
    }
    return next;
  }

  // ---- night-seer-peek ----
  if (s.phase === 'night-seer' && (t.kind === 'peek' || t.kind === 'abstain')) {
    const next = clone(s);
    if (t.kind === 'peek') {
      const target = (t.data as { target?: Id<'twins'> })?.target;
      const role = target ? next.roles[asKey(target)] : undefined;
      if (target && role) {
        next.seerKnowledge.push({ target, role, day: next.day });
      }
    }
    next.phase = aliveByRole(next, 'witch').length > 0 ? 'night-witch' : 'night-resolve';
    return next;
  }

  // ---- night-witch-act ----
  if (s.phase === 'night-witch' && (t.kind === 'witch-act' || t.kind === 'abstain')) {
    const next = clone(s);
    if (t.kind === 'witch-act') {
      const data = t.data as { use_save?: boolean; poison_target?: Id<'twins'>; skip?: boolean } | undefined;
      // Save: clears the kill (but only if save potion available + actually
      // a kill is pending + witch isn't trying to save AND poison same night).
      if (data?.use_save && next.witchSavePotion && next.pendingWolfKill && !data?.poison_target) {
        next.witchSaveUsedTonight = true;
        next.witchSavePotion = false;
      }
      // Poison: queues a kill (if poison potion available + target alive +
      // witch isn't trying to save AND poison same night).
      if (data?.poison_target && next.witchPoisonPotion && !data?.use_save) {
        const target = data.poison_target;
        if (next.alive.includes(target)) {
          next.pendingPoisonTarget = target;
          next.witchPoisonPotion = false;
        }
      }
    }
    next.phase = 'night-resolve';
    return next;
  }

  // ---- night-resolve (system) ----
  if (s.phase === 'night-resolve' && t.kind === 'system') {
    return applyNightResolve(s);
  }

  // ---- hunter-shoot ----
  if (s.phase === 'hunter-shoot' && (t.kind === 'hunter-shoot' || t.kind === 'abstain')) {
    const next = clone(s);
    if (t.kind === 'hunter-shoot') {
      const target = (t.data as { target?: Id<'twins'> })?.target;
      if (target && next.alive.includes(target)) {
        next.alive = next.alive.filter((id) => id !== target);
        next.publicLog.push(
          `Day ${next.day + 1}: The dying hunter (${next.pendingHunterShot}) shot ${target}.`,
        );
      }
    }
    // Honor where the hunter shot was triggered from — night death returns
    // to day-speak; day lynch advances to next night. Without this, a night
    // hunter death would skip the entire day cycle.
    const returnTo = next.phaseAfterHunterShot ?? 'day-speak';
    next.pendingHunterShot = undefined;
    next.phaseAfterHunterShot = undefined;
    return transitionAfterResolve(next, returnTo === 'day-speak');
  }

  // ---- last-words ----
  if (s.phase === 'last-words' && (t.kind === 'last-words' || t.kind === 'abstain')) {
    const next = clone(s);
    const speaker = next.lastWordsQueue[0];
    // If the speaker is the sheriff, handle badge decision. Default = destroy.
    if (speaker && next.sheriff && speaker === next.sheriff) {
      const data = t.data as { badge_decision?: string } | undefined;
      const dec = data?.badge_decision;
      if (dec && dec.startsWith('pass:')) {
        const passToId = dec.slice('pass:'.length).trim();
        // Validate the target is still alive (sheriff died this round, so
        // target must be in current alive list, not including sheriff).
        const target = passToId as unknown as Id<'twins'>;
        if (next.alive.includes(target)) {
          next.sheriff = target;
          next.sheriffHas1_5x = false; // inheritor doesn't get 1.5x
          next.publicLog.push(
            `Day ${next.day + 1}: ${speaker} passed the sheriff badge to ${target}.`,
          );
        } else {
          // Invalid target → destroy.
          next.sheriff = undefined;
          next.sheriffHas1_5x = false;
          next.publicLog.push(
            `Day ${next.day + 1}: ${speaker} destroyed the sheriff badge.`,
          );
        }
      } else {
        // Destroy (explicit or default).
        next.sheriff = undefined;
        next.sheriffHas1_5x = false;
        next.publicLog.push(
          `Day ${next.day + 1}: ${speaker} destroyed the sheriff badge.`,
        );
      }
    }
    next.lastWordsQueue = next.lastWordsQueue.slice(1);
    return transitionAfterResolve(next, false);
  }

  // ---- sheriff-claim ----
  if (s.phase === 'sheriff-claim' && (t.kind === 'sheriff-claim' || t.kind === 'abstain')) {
    const next = clone(s);
    if (t.kind === 'sheriff-claim' && t.actorTwinId) {
      const data = t.data as { run?: boolean } | undefined;
      if (data?.run) {
        next.sheriffCandidates.push(t.actorTwinId);
      }
    }
    next.sheriffClaimCursor += 1;
    if (next.sheriffClaimCursor >= next.alive.length) {
      // Claims done. Decide what comes next.
      if (next.sheriffCandidates.length === 0) {
        // Nobody ran → no sheriff this game. Advance to day-speak.
        next.publicLog.push(
          `Day ${next.day + 1}: 无人上警 — the village has no sheriff this game.`,
        );
        next.sheriffElectionDone = true;
        next.phase = 'day-speak';
        next.cursor = 0;
      } else if (next.sheriffCandidates.length === next.alive.length) {
        // Everyone ran → no 警下 to vote → 流警 (no sheriff).
        next.publicLog.push(
          `Day ${next.day + 1}: 全员上警，无人投票 — 流警, no sheriff this game.`,
        );
        next.sheriffElectionDone = true;
        next.sheriffCandidates = [];
        next.phase = 'day-speak';
        next.cursor = 0;
      } else if (next.sheriffCandidates.length === 1) {
        // Unopposed → auto-elected.
        const winner = next.sheriffCandidates[0]!;
        next.sheriff = winner;
        next.sheriffHas1_5x = true;
        next.publicLog.push(
          `Day ${next.day + 1}: ${winner} 单独上警, auto-elected sheriff (1.5x vote weight).`,
        );
        next.sheriffElectionDone = true;
        next.sheriffCandidates = [];
        next.phase = 'day-speak';
        next.cursor = 0;
      } else {
        // Multiple candidates → 警下 vote.
        next.phase = 'sheriff-vote';
      }
    }
    return next;
  }

  // ---- sheriff-vote ----
  if (s.phase === 'sheriff-vote' && (t.kind === 'sheriff-vote' || t.kind === 'abstain')) {
    const next = clone(s);
    if (t.kind === 'sheriff-vote' && t.actorTwinId) {
      const target = (t.data as { target?: Id<'twins'> })?.target;
      if (target && next.sheriffCandidates.includes(target)) {
        next.sheriffVotes[asKey(t.actorTwinId)] = asKey(target);
      }
    }
    // Check if all 警下 (non-candidates) have voted.
    const electorate = next.alive.filter((id) => !next.sheriffCandidates.includes(id));
    const allVoted = electorate.every((id) => next.sheriffVotes[asKey(id)]);
    if (allVoted) {
      // Tally
      const tally: Record<string, number> = {};
      for (const v of Object.values(next.sheriffVotes)) {
        tally[v] = (tally[v] || 0) + 1;
      }
      let max = 0;
      let winner: string | null = null;
      let tied = false;
      for (const [c, n] of Object.entries(tally)) {
        if (n > max) { max = n; winner = c; tied = false; }
        else if (n === max) { tied = true; }
      }
      if (winner && !tied && max > 0) {
        const sheriffId = winner as unknown as Id<'twins'>;
        next.sheriff = sheriffId;
        next.sheriffHas1_5x = true;
        next.publicLog.push(
          `Day ${next.day + 1}: ${sheriffId} elected sheriff with ${max} votes (1.5x weight).`,
        );
      } else {
        // Tie or no votes → no sheriff (v1 skips the PK speech).
        next.publicLog.push(
          `Day ${next.day + 1}: Sheriff election tied/inconclusive — no sheriff this game.`,
        );
      }
      next.sheriffCandidates = [];
      next.sheriffVotes = {};
      next.sheriffElectionDone = true;
      next.phase = 'day-speak';
      next.cursor = 0;
    }
    return next;
  }

  // ---- sheriff-vote system fallback ----
  if (s.phase === 'sheriff-vote' && t.kind === 'system') {
    // Defensive — if planNextTurn returned a system because no voters left.
    const next = clone(s);
    next.sheriffCandidates = [];
    next.sheriffVotes = {};
    next.sheriffElectionDone = true;
    next.phase = 'day-speak';
    next.cursor = 0;
    return next;
  }

  // ---- sheriff-pull-vote ----
  if (s.phase === 'sheriff-pull-vote' && (t.kind === 'sheriff-pull-vote' || t.kind === 'abstain' || t.kind === 'system')) {
    const next = clone(s);
    next.phase = 'day-vote';
    next.cursor = 0;
    return next;
  }

  // ---- day-speak ----
  if (s.phase === 'day-speak' && (t.kind === 'speak' || t.kind === 'abstain')) {
    const next = clone(s);
    next.cursor += 1;
    if (next.cursor >= next.alive.length) {
      // After all alive players spoke, if there's a sheriff alive, they
      // get the final pull-vote turn before voting begins.
      if (next.sheriff && next.alive.includes(next.sheriff)) {
        next.phase = 'sheriff-pull-vote';
      } else {
        next.phase = 'day-vote';
        next.cursor = 0;
      }
    }
    return next;
  }

  // ---- day-vote ----
  if (s.phase === 'day-vote' && (t.kind === 'vote' || t.kind === 'abstain')) {
    const next = clone(s);
    if (t.kind === 'vote' && t.actorTwinId) {
      const target = (t.data as { target?: Id<'twins'> })?.target;
      if (target && next.alive.includes(target)) {
        next.pendingVotes[asKey(t.actorTwinId)] = asKey(target);
      }
    }
    next.cursor += 1;
    if (next.cursor >= next.alive.length) {
      return applyDayResolve(next);
    }
    return next;
  }

  // ---- day-resolve (system, defensive) ----
  if (s.phase === 'day-resolve' && t.kind === 'system') {
    return applyDayResolve(s);
  }

  // No matching transition — return unchanged.
  return s;
}

export type { WerewolfPhase, WerewolfRole };
