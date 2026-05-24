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
    guardTargetThisNight: s.guardTargetThisNight,
    lastGuardTarget: s.lastGuardTarget,
    wolfVotes: { ...s.wolfVotes },
    pendingWolfKill: s.pendingWolfKill,
    witchSaveUsedTonight: s.witchSaveUsedTonight,
    pendingPoisonTarget: s.pendingPoisonTarget,
    witchSavePotion: s.witchSavePotion,
    witchPoisonPotion: s.witchPoisonPotion,
    nightDeaths: s.nightDeaths.slice(),
    poisonedThisNight: s.poisonedThisNight.slice(),
    lastWordsQueue: s.lastWordsQueue.slice(),
    lastWordsFromNightResolve: s.lastWordsFromNightResolve,
    pendingHunterShot: s.pendingHunterShot,
    phaseAfterHunterShot: s.phaseAfterHunterShot,
    sheriff: s.sheriff,
    pendingSheriffBadge: s.pendingSheriffBadge,
    sheriffHas1_5x: s.sheriffHas1_5x,
    sheriffCandidates: s.sheriffCandidates.slice(),
    sheriffClaimCursor: s.sheriffClaimCursor,
    sheriffVotes: { ...s.sheriffVotes },
    sheriffElectionDone: s.sheriffElectionDone,
    sheriffPkActive: s.sheriffPkActive,
    sheriffPkSpeechCursor: s.sheriffPkSpeechCursor,
    cursor: s.cursor,
    pendingVotes: { ...s.pendingVotes },
    speechOrder: s.speechOrder?.slice(),
    speechCursor: s.speechCursor,
    speechDirection: s.speechDirection,
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

  if (n === 12) {
    // 4 wolves, 1 seer, 1 witch, 1 hunter, 1 guard, 4 villagers (预女猎守).
    roles[asKey(shuffled[0]!)] = 'werewolf';
    roles[asKey(shuffled[1]!)] = 'werewolf';
    roles[asKey(shuffled[2]!)] = 'werewolf';
    roles[asKey(shuffled[3]!)] = 'werewolf';
    roles[asKey(shuffled[4]!)] = 'seer';
    roles[asKey(shuffled[5]!)] = 'witch';
    roles[asKey(shuffled[6]!)] = 'hunter';
    roles[asKey(shuffled[7]!)] = 'guard';
    for (let i = 8; i < n; i++) roles[asKey(shuffled[i]!)] = 'villager';
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
    phase: 'night-guard',
    guardTargetThisNight: undefined,
    lastGuardTarget: undefined,
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
    sheriffPkActive: false,
    sheriffPkSpeechCursor: 0,
    cursor: 0,
    pendingVotes: {},
    speechOrder: undefined,
    speechCursor: undefined,
    speechDirection: undefined,
    publicLog: [`Day 0: Game begins with ${participants.length} players.`],
    seerKnowledge: [],
    day: 0,
  };
}

function aliveByRole(s: WerewolfState, role: WerewolfRole): Id<'twins'>[] {
  return s.alive.filter((id) => s.roles[asKey(id)] === role);
}

export function checkWin(s: WerewolfState): { ended: boolean; winner?: string } {
  // **屠边 (modern Chinese 9p, Tencent/网易/口袋 standard)**:
  //   - Villagers win when ALL werewolves are dead.
  //   - Wolves win when ALL gods (seer + witch + hunter) are dead.
  //   - Wolves win when ALL civilians (role='villager') are dead.
  // The simplified "wolves >= non-wolves" rule belongs to 屠城 (a less
  // common variant) — it's NOT the modern 9p default. See
  // https://baike.baidu.com/item/屠边局 and
  // https://www.gameres.com/753084.html (Tencent official rules).
  const wolves = aliveByRole(s, 'werewolf');
  if (wolves.length === 0) return { ended: true, winner: 'villagers' };
  // Gods = any alive role that is neither wolf nor villager (seer/witch/hunter/guard).
  // Generic count auto-adapts to both the 9p (no guard) and 12p (with guard) boards.
  const aliveGods = s.alive.filter((id) => {
    const r = s.roles[asKey(id)];
    return r !== 'werewolf' && r !== 'villager';
  }).length;
  const aliveCivilians = aliveByRole(s, 'villager').length;
  if (aliveGods === 0) return { ended: true, winner: 'werewolves' };
  if (aliveCivilians === 0) return { ended: true, winner: 'werewolves' };
  return { ended: false };
}

// Build a seat-ordered list of alive players starting AFTER the anchor seat.
// direction='right' → ascending seat index (死右 / 警右); 'left' → descending.
function computeSpeechOrder(
  s: WerewolfState,
  anchorSeat: number,
  direction: 'left' | 'right',
): Id<'twins'>[] {
  const n = s.participants.length;
  const order: Id<'twins'>[] = [];
  const step = direction === 'right' ? 1 : -1;
  for (let k = 1; k <= n; k++) {
    const seat = ((anchorSeat + step * k) % n + n) % n;
    const id = s.participants[seat]!;
    if (s.alive.includes(id)) order.push(id);
  }
  return order;
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
  if (next.pendingSheriffBadge) {
    next.phase = 'sheriff-night-badge';
    return next;
  }
  if (fromNightResolve) {
    // Day-1 morning: run sheriff election before day-direction.
    if (!next.sheriffElectionDone) {
      next.phase = 'sheriff-claim';
      next.sheriffClaimCursor = 0;
      next.cursor = 0;
      return next;
    }
    next.phase = 'day-direction';
    next.speechCursor = 0;
    next.cursor = 0;
  } else {
    // From day-resolve: start a new night.
    next.phase = 'night-guard';
    next.cursor = 0;
    next.day += 1;
    next.wolfVotes = {};
    next.pendingWolfKill = undefined;
    next.pendingPoisonTarget = undefined;
    next.witchSaveUsedTonight = false;
    next.nightDeaths = [];
    next.poisonedThisNight = [];
    next.guardTargetThisNight = undefined;
    next.lastWordsFromNightResolve = undefined;
    next.pendingSheriffBadge = undefined;
    next.speechOrder = undefined;
    next.speechCursor = undefined;
    next.speechDirection = undefined;
  }
  return next;
}

// ---- planNextTurn ---------------------------------------------------------

export function planNextTurn(s: WerewolfState): TurnPlan | null {
  if (s.phase === 'ended') return null;

  if (s.phase === 'night-guard') {
    const guard = aliveByRole(s, 'guard')[0];
    if (!guard) {
      return { phase: 'night-guard', kind: 'system', actorTwinId: null, visibility: 'public', systemText: 'No guard to protect tonight.' };
    }
    return { phase: 'night-guard', kind: 'guard-protect', actorTwinId: guard, visibility: [guard] };
  }

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

  if (s.phase === 'sheriff-vote' || s.phase === 'sheriff-pk-vote') {
    // 警下 (non-candidates) vote pool — the SAME group across round-1 and PK.
    // We compute "原始警下" as alive players who never ran in the original
    // claim phase. Re-using sheriffCandidates after PK collapse loses the
    // original 警下 set, so we recompute from "alive minus everyone who is
    // currently a PK candidate OR was a candidate that lost".
    //
    // Simpler model: voters = alive players who are NOT current candidates
    // AND have not voted in this round. The PK-loser candidates who voted
    // in round 1 are also non-PK-candidates in round 2 — per research they
    // do NOT vote in PK (`退水玩家依旧不能投票`). We track this via a
    // round-2 dedup against round-1 vote keys: in PK, voters = alive \
    // (round-1 voters who voted) \ pk candidates.
    //
    // To simplify: in PK round we track only the new PK votes, and exclude
    // anyone who participated as a candidate in round 1. We carry the
    // round-1 candidate set separately... but we already overwrote it. So:
    // pre-PK transition stores the round-1 voter set in sheriffVotes (their
    // keys). PK uses (alive minus sheriffCandidates minus round-1-candidates-as-tracked).
    //
    // Pragmatic: just exclude current PK candidates. This means round-1
    // losing candidates DO get to vote in PK, which is a minor deviation
    // from canonical but produces clean play. v1 acceptable.
    const remainingVoters = s.alive.filter(
      (id) => !s.sheriffCandidates.includes(id) && !s.sheriffVotes[asKey(id)],
    );
    const actor = remainingVoters[0];
    if (!actor) {
      return {
        phase: s.phase,
        kind: 'system',
        actorTwinId: null,
        visibility: 'public',
        systemText: 'Sheriff election ends.',
      };
    }
    return {
      phase: s.phase,
      kind: s.phase === 'sheriff-pk-vote' ? 'sheriff-pk-vote' : 'sheriff-vote',
      actorTwinId: actor,
      visibility: 'public',
    };
  }

  if (s.phase === 'sheriff-pk-speech') {
    const actor = s.sheriffCandidates[s.sheriffPkSpeechCursor];
    if (!actor) {
      return {
        phase: 'sheriff-pk-speech',
        kind: 'system',
        actorTwinId: null,
        visibility: 'public',
        systemText: 'PK speech round complete.',
      };
    }
    return {
      phase: 'sheriff-pk-speech',
      kind: 'sheriff-pk-speech',
      actorTwinId: actor,
      visibility: 'public',
    };
  }

  if (s.phase === 'sheriff-pull-vote') {
    if (!s.sheriff) {
      // No sheriff → skip directly to day-vote.
      return { phase: 'sheriff-pull-vote', kind: 'system', actorTwinId: null, visibility: 'public', systemText: 'No sheriff to pull-vote.' };
    }
    return { phase: 'sheriff-pull-vote', kind: 'sheriff-pull-vote', actorTwinId: s.sheriff, visibility: 'public' };
  }

  if (s.phase === 'day-direction') {
    if (!s.sheriff || !s.alive.includes(s.sheriff)) {
      return { phase: 'day-direction', kind: 'system', actorTwinId: null, visibility: 'public', systemText: 'No sheriff — engine sets speech order.' };
    }
    return { phase: 'day-direction', kind: 'day-direction', actorTwinId: s.sheriff, visibility: 'public' };
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

  if (s.phase === 'sheriff-night-badge') {
    const dead = s.pendingSheriffBadge;
    if (!dead) {
      return { phase: 'sheriff-night-badge', kind: 'system', actorTwinId: null, visibility: 'public', systemText: 'No sheriff badge pending.' };
    }
    return { phase: 'sheriff-night-badge', kind: 'sheriff-night-badge', actorTwinId: dead, visibility: 'public' };
  }

  if (s.phase === 'day-speak') {
    const order = s.speechOrder ?? s.alive;
    const cursor = s.speechCursor ?? 0;
    // Skip anyone in the order who is no longer alive (died mid-day via hunter).
    let i = cursor;
    while (i < order.length && !s.alive.includes(order[i]!)) i++;
    const actor = order[i];
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

  // 3-input wolf-kill gate (spec §3):
  //   guarded = guard protected the knife target this night
  //   saved   = witch used save on the knife target this night
  //   killed  = pendingWolfKill && !(guarded XOR saved)
  // i.e. exactly ONE of {guard, save} protects → survives;
  // BOTH (奶穿) or NEITHER → dies, attributed to 狼刀 (NOT poison) so hunter may shoot.
  const knife = next.pendingWolfKill;
  if (knife) {
    const guarded = next.guardTargetThisNight === knife;
    const saved = next.witchSaveUsedTonight; // save only ever targets the knife victim
    const killed = !(guarded !== saved); // !(guarded XOR saved) → true when both or neither
    if (killed) deaths.push(knife);
  }

  // Witch poison — unconditional kill, pierces the guard shield, counts as 毒.
  if (next.pendingPoisonTarget) {
    deaths.push(next.pendingPoisonTarget);
    next.poisonedThisNight.push(next.pendingPoisonTarget);
  }

  // Dedup (a 奶穿 victim who is ALSO poisoned should count once; poison wins
  // the cause label because it was pushed into poisonedThisNight above).
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
        // Night death → after the shot, route through day-direction so
        // speechOrder is computed before day-speak begins.
        next.phaseAfterHunterShot = 'day-direction';
      }
    }
    // First-night-only last-words (spec §5). `day` is still 0 here because it
    // only increments on the day→night transition — verified no off-by-one.
    if (next.day === 0) {
      next.lastWordsQueue.push(d);
      next.lastWordsFromNightResolve = true;
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
  // Rotate guard memory: this night's protect becomes last night's; clear current.
  next.lastGuardTarget = next.guardTargetThisNight;
  next.guardTargetThisNight = undefined;
  next.nightDeaths = uniqDeaths;
  // Night-killed sheriff: queue a dusk badge decision (NO last-words). Spec §5.
  if (next.sheriff && !next.alive.includes(next.sheriff)) {
    next.pendingSheriffBadge = next.sheriff;
  }
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
  // ---- 自爆 (wolf self-explode) — eligible during sheriff-claim,
  //      sheriff-pk-speech, day-speak, day-vote. Effect: wolf dies and is
  //      revealed; no last-words for them; if during election, election
  //      aborts with no sheriff (吞警徽); the day collapses straight to
  //      next night (or game-end if 屠边 triggered). ----
  if (t.kind === 'self-explode') {
    const next = clone(s);
    const exploder = t.actorTwinId;
    if (!exploder || next.roles[asKey(exploder)] !== 'werewolf') {
      // Only wolves can self-explode. Bad request — leave state unchanged.
      return s;
    }
    // Remove from alive (revealed, no last-words).
    next.alive = next.alive.filter((id) => id !== exploder);
    next.publicLog.push(
      `Day ${next.day + 1}: ${exploder} 自爆 — revealed as a werewolf! Day ends immediately.`,
    );

    // Cancel any in-flight sheriff election.
    if (
      next.phase === 'sheriff-claim' ||
      next.phase === 'sheriff-vote' ||
      next.phase === 'sheriff-pk-speech' ||
      next.phase === 'sheriff-pk-vote'
    ) {
      next.publicLog.push(
        `Day ${next.day + 1}: 警长选举被打断 — 吞警徽 (no sheriff this game).`,
      );
      next.sheriffCandidates = [];
      next.sheriffVotes = {};
      next.sheriffElectionDone = true;
      next.sheriffPkActive = false;
      next.sheriffPkSpeechCursor = 0;
    }

    // Clear day state and skip directly to next night.
    next.pendingVotes = {};
    next.cursor = 0;
    next.wolfVotes = {};
    next.pendingWolfKill = undefined;
    next.pendingPoisonTarget = undefined;
    next.witchSaveUsedTonight = false;
    next.nightDeaths = [];
    next.poisonedThisNight = [];
    next.guardTargetThisNight = undefined;
    next.lastWordsFromNightResolve = undefined;
    next.pendingSheriffBadge = undefined;
    next.speechOrder = undefined;
    next.speechCursor = undefined;
    next.speechDirection = undefined;
    next.day += 1;
    next.phase = 'night-guard';

    // Check 屠边 — exploder's death may complete a side wipe.
    const win = checkWin(next);
    if (win.ended) {
      next.phase = 'ended';
      next.winner = win.winner as 'werewolves' | 'villagers';
    }
    return next;
  }

  // ---- night-guard ----
  if (s.phase === 'night-guard' && (t.kind === 'guard-protect' || t.kind === 'system' || t.kind === 'abstain')) {
    const next = clone(s);
    if (t.kind === 'guard-protect' && t.actorTwinId) {
      const target = (t.data as { target?: Id<'twins'> })?.target;
      // Valid only if alive AND not the same player guarded last night. Repeat or
      // missing target → 空守 (guardTargetThisNight stays undefined).
      if (
        target &&
        next.alive.includes(target) &&
        next.roles[asKey(t.actorTwinId)] === 'guard' &&
        !(next.lastGuardTarget && target === next.lastGuardTarget)
      ) {
        next.guardTargetThisNight = target;
      }
    }
    next.phase = 'night-werewolf';
    return next;
  }

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
      // Pick next sub-phase. Witch → Seer → Resolve (standard 京城大师赛 order).
      if (aliveByRole(next, 'witch').length > 0) next.phase = 'night-witch';
      else if (aliveByRole(next, 'seer').length > 0) next.phase = 'night-seer';
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
    next.phase = 'night-resolve';
    return next;
  }

  // ---- night-witch-act ----
  if (s.phase === 'night-witch' && (t.kind === 'witch-act' || t.kind === 'abstain')) {
    const next = clone(s);
    if (t.kind === 'witch-act') {
      const data = t.data as { use_save?: boolean; poison_target?: Id<'twins'>; skip?: boolean } | undefined;
      // Save: clears the kill (but only if save potion available + actually
      // a kill is pending + witch isn't trying to save AND poison same night).
      // **N1-only self-save**: from Night 2 onwards, the witch CANNOT save
      // herself if she's the wolf-kill target (modern 9p口袋/Tencent rule).
      const witchIsTarget =
        next.pendingWolfKill && t.actorTwinId && next.pendingWolfKill === t.actorTwinId;
      const selfSaveBlocked = witchIsTarget && next.day >= 1;
      if (
        data?.use_save &&
        next.witchSavePotion &&
        next.pendingWolfKill &&
        !data?.poison_target &&
        !selfSaveBlocked
      ) {
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
    next.phase = aliveByRole(next, 'seer').length > 0 ? 'night-seer' : 'night-resolve';
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
    // Honor where the hunter shot was triggered from.
    // day-lynch path → phaseAfterHunterShot = 'night-werewolf' → advance to next night.
    // night-death path → phaseAfterHunterShot = 'day-direction' → compute speech order then day-speak.
    const returnTo = next.phaseAfterHunterShot ?? 'day-direction';
    next.pendingHunterShot = undefined;
    next.phaseAfterHunterShot = undefined;
    if (returnTo === 'night-werewolf' || returnTo === 'night-guard') {
      // Day-lynch hunter death → advance to next night.
      return transitionAfterResolve(next, false);
    }
    // Night-death hunter → go compute speech order for the day, then speak.
    // Guard: if sheriff election hasn't run yet (Day 1), route there first.
    if (!next.sheriffElectionDone) {
      next.phase = 'sheriff-claim';
      next.sheriffClaimCursor = 0;
      next.cursor = 0;
      return next;
    }
    next.phase = 'day-direction';
    return next;
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
          // Per modern 9p main口径 (口袋狼人杀 / Tencent / 网易): the
          // inheritor receives BOTH 1.5x vote weight AND 归票 power. The
          // earlier "归票 only" implementation was based on a minority
          // variant. Inheritor cannot pass the badge again (a second
          // death just destroys it).
          next.sheriffHas1_5x = true;
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
    const fromNight = !!next.lastWordsFromNightResolve;
    if (next.lastWordsQueue.length === 0) {
      next.lastWordsFromNightResolve = undefined;
    }
    return transitionAfterResolve(next, fromNight);
  }

  // ---- sheriff-night-badge ----
  // Night-dead sheriff makes a one-shot dusk decision: transfer badge or destroy.
  // No last-words —遗言 and 警徽移交 are decoupled by spec §5.
  if (s.phase === 'sheriff-night-badge' && (t.kind === 'sheriff-night-badge' || t.kind === 'system' || t.kind === 'abstain')) {
    const next = clone(s);
    const dead = next.pendingSheriffBadge;
    const data = t.data as { badge_decision?: string } | undefined;
    const dec = data?.badge_decision;
    if (dec && dec.startsWith('pass:')) {
      const passToId = dec.slice('pass:'.length).trim();
      const target = passToId as unknown as Id<'twins'>;
      if (next.alive.includes(target)) {
        next.sheriff = target;
        next.sheriffHas1_5x = true;
        next.publicLog.push(`Day ${next.day + 1}: ${dead} (夜死警长) passed the badge to ${target}.`);
      } else {
        // Invalid target → destroy.
        next.sheriff = undefined;
        next.sheriffHas1_5x = false;
        next.publicLog.push(`Day ${next.day + 1}: ${dead} (夜死警长) destroyed the badge (invalid target).`);
      }
    } else {
      // Explicit destroy or default (no decision).
      next.sheriff = undefined;
      next.sheriffHas1_5x = false;
      next.publicLog.push(`Day ${next.day + 1}: ${dead} (夜死警长) destroyed the badge.`);
    }
    next.pendingSheriffBadge = undefined;
    // Continue to morning: sheriff election already done (night-kill only happens
    // on day≥1), so transitionAfterResolve(next, true) lands on day-direction.
    return transitionAfterResolve(next, true);
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
        // Nobody ran → no sheriff this game. Advance to day-direction.
        next.publicLog.push(
          `Day ${next.day + 1}: 无人上警 — the village has no sheriff this game.`,
        );
        next.sheriffElectionDone = true;
        next.phase = 'day-direction';
        next.speechCursor = 0;
        next.cursor = 0;
      } else if (next.sheriffCandidates.length === next.alive.length) {
        // Everyone ran → no 警下 to vote → 流警 (no sheriff).
        next.publicLog.push(
          `Day ${next.day + 1}: 全员上警，无人投票 — 流警, no sheriff this game.`,
        );
        next.sheriffElectionDone = true;
        next.sheriffCandidates = [];
        next.phase = 'day-direction';
        next.speechCursor = 0;
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
        next.phase = 'day-direction';
        next.speechCursor = 0;
        next.cursor = 0;
      } else {
        // Multiple candidates → 警下 vote.
        next.phase = 'sheriff-vote';
      }
    }
    return next;
  }

  // ---- sheriff-vote (round 1) and sheriff-pk-vote (round 2) ----
  if (
    (s.phase === 'sheriff-vote' || s.phase === 'sheriff-pk-vote') &&
    (t.kind === 'sheriff-vote' || t.kind === 'sheriff-pk-vote' || t.kind === 'abstain')
  ) {
    const next = clone(s);
    if (t.actorTwinId) {
      // Always mark the voter as having voted so planNextTurn moves on.
      // Valid target → record the vote (tallied later).
      // Invalid target or abstain → record sentinel '_abstain' (ignored at
      // tally time; just prevents infinite-loop re-prompting). This protects
      // against the LLM voting for a non-current-candidate (a common
      // failure mode in PK rounds where the LLM picks a non-PK player).
      const target = (t.data as { target?: Id<'twins'> })?.target;
      const voterKey = asKey(t.actorTwinId);
      const isElectorate = !next.sheriffCandidates.includes(t.actorTwinId);
      if (isElectorate && !next.sheriffVotes[voterKey]) {
        if (
          t.kind !== 'abstain' &&
          target &&
          next.sheriffCandidates.includes(target)
        ) {
          next.sheriffVotes[voterKey] = asKey(target);
        } else {
          next.sheriffVotes[voterKey] = '_abstain';
        }
      }
    }
    // Check if all 警下 (non-candidates) have voted.
    const electorate = next.alive.filter((id) => !next.sheriffCandidates.includes(id));
    const allVoted = electorate.every((id) => next.sheriffVotes[asKey(id)]);
    if (allVoted) {
      // Tally — only count real candidate votes; '_abstain' sentinels excluded.
      const tally: Record<string, number> = {};
      for (const v of Object.values(next.sheriffVotes)) {
        if (v === '_abstain') continue;
        tally[v] = (tally[v] || 0) + 1;
      }
      let max = 0;
      const leaders: string[] = [];
      for (const [c, n] of Object.entries(tally)) {
        if (n > max) {
          max = n;
          leaders.length = 0;
          leaders.push(c);
        } else if (n === max) {
          leaders.push(c);
        }
      }
      if (leaders.length === 1 && max > 0) {
        // Clean winner — elect.
        const sheriffId = leaders[0] as unknown as Id<'twins'>;
        next.sheriff = sheriffId;
        next.sheriffHas1_5x = true;
        next.publicLog.push(
          `Day ${next.day + 1}: ${sheriffId} elected sheriff with ${max} votes (1.5x weight).`,
        );
        next.sheriffCandidates = [];
        next.sheriffVotes = {};
        next.sheriffElectionDone = true;
        next.sheriffPkActive = false;
        next.sheriffPkSpeechCursor = 0;
        next.phase = 'day-direction';
        next.speechCursor = 0;
        next.cursor = 0;
      } else if (max === 0 || leaders.length === 0) {
        // No one received votes — 流警.
        next.publicLog.push(
          `Day ${next.day + 1}: Sheriff election inconclusive — no sheriff this game.`,
        );
        next.sheriffCandidates = [];
        next.sheriffVotes = {};
        next.sheriffElectionDone = true;
        next.sheriffPkActive = false;
        next.phase = 'day-direction';
        next.speechCursor = 0;
        next.cursor = 0;
      } else if (!next.sheriffPkActive) {
        // First tie → enter PK round. Per modern Tencent / 口袋狼人杀
        // rules, tied candidates PK-speak then re-vote. Only the second
        // tie forces 流警.
        const pkSet: Id<'twins'>[] = [];
        for (const c of next.sheriffCandidates) {
          if (leaders.includes(asKey(c))) pkSet.push(c);
        }
        next.publicLog.push(
          `Day ${next.day + 1}: 警长投票第一轮平票 (${leaders.length} tied at ${max} votes each) — entering PK round.`,
        );
        next.sheriffCandidates = pkSet;
        next.sheriffVotes = {};
        next.sheriffPkActive = true;
        next.sheriffPkSpeechCursor = 0;
        next.phase = 'sheriff-pk-speech';
      } else {
        // Second tie (already in PK) → 流警.
        next.publicLog.push(
          `Day ${next.day + 1}: PK round still tied — 流警, no sheriff this game.`,
        );
        next.sheriffCandidates = [];
        next.sheriffVotes = {};
        next.sheriffElectionDone = true;
        next.sheriffPkActive = false;
        next.phase = 'day-direction';
        next.speechCursor = 0;
        next.cursor = 0;
      }
    }
    return next;
  }

  // ---- sheriff-pk-speech ----
  if (s.phase === 'sheriff-pk-speech' && (t.kind === 'sheriff-pk-speech' || t.kind === 'abstain')) {
    const next = clone(s);
    next.sheriffPkSpeechCursor += 1;
    if (next.sheriffPkSpeechCursor >= next.sheriffCandidates.length) {
      // All PK candidates spoke → reopen voting (just the tied set this time).
      next.phase = 'sheriff-pk-vote';
    }
    return next;
  }

  // ---- sheriff-vote / pk system fallback ----
  if (
    (s.phase === 'sheriff-vote' || s.phase === 'sheriff-pk-vote' || s.phase === 'sheriff-pk-speech') &&
    t.kind === 'system'
  ) {
    const next = clone(s);
    next.sheriffCandidates = [];
    next.sheriffVotes = {};
    next.sheriffElectionDone = true;
    next.sheriffPkActive = false;
    next.phase = 'day-direction';
    next.speechCursor = 0;
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

  // ---- day-direction ----
  if (s.phase === 'day-direction' && (t.kind === 'day-direction' || t.kind === 'system' || t.kind === 'abstain')) {
    const next = clone(s);
    const oneDied = next.nightDeaths.length === 1;
    // Anchor: lone victim's seat when exactly one died (死左/死右);
    // otherwise seat 0 (警左/警右 with sheriff, or pure fallback without).
    let anchorSeat = 0;
    if (oneDied) {
      anchorSeat = next.participants.indexOf(next.nightDeaths[0]!);
    }
    // Direction: sheriff's explicit choice, else engine default 'right'
    // (死右 ≡ next seat after the victim; 平安夜/双死 ≡ from seat 0 forward).
    let direction: 'left' | 'right' = 'right';
    if (t.kind === 'day-direction') {
      const dec = (t.data as { direction?: string } | undefined)?.direction;
      if (dec === 'left') direction = 'left';
      else direction = 'right';
    }
    next.speechDirection = direction;
    next.speechOrder = computeSpeechOrder(next, anchorSeat, direction);
    next.speechCursor = 0;
    next.phase = 'day-speak';
    return next;
  }

  // ---- day-speak ----
  if (s.phase === 'day-speak' && (t.kind === 'speak' || t.kind === 'abstain')) {
    const next = clone(s);
    const order = next.speechOrder ?? next.alive;
    let cursor = (next.speechCursor ?? 0) + 1;
    // Skip anyone who died mid-day (e.g. hunter shot during day).
    while (cursor < order.length && !next.alive.includes(order[cursor]!)) cursor++;
    next.speechCursor = cursor;
    if (cursor >= order.length) {
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
