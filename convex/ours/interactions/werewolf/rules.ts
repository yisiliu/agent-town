import type { Id } from '../../../_generated/dataModel';
import type { AppliedTurn, TurnPlan } from '../types';
import type { WerewolfPhase, WerewolfRole, WerewolfState } from './state';

// Mulberry32 — small deterministic PRNG; sufficient for role shuffles.
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
    phase: s.phase,
    cursor: s.cursor,
    pendingVotes: { ...s.pendingVotes },
    pendingKill: s.pendingKill,
    publicLog: s.publicLog.slice(),
    seerKnowledge: s.seerKnowledge.slice(),
    day: s.day,
    winner: s.winner,
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
  const roles: Record<string, WerewolfRole> = {};
  roles[shuffled[0] as unknown as string] = 'werewolf';
  roles[shuffled[1] as unknown as string] = 'seer';
  for (let i = 2; i < shuffled.length; i++) {
    roles[shuffled[i] as unknown as string] = 'villager';
  }
  return {
    participants: participants.slice(),
    roles,
    alive: participants.slice(),
    phase: 'night-werewolf',
    cursor: 0,
    pendingVotes: {},
    publicLog: [`Day 0: Game begins with ${participants.length} players.`],
    seerKnowledge: [],
    day: 0,
  };
}

function liveByRole(s: WerewolfState, role: WerewolfRole): Id<'twins'>[] {
  return s.alive.filter((id) => s.roles[id as unknown as string] === role);
}

export function checkWin(s: WerewolfState): { ended: boolean; winner?: string } {
  const wolves = liveByRole(s, 'werewolf');
  if (wolves.length === 0) return { ended: true, winner: 'villagers' };
  const nonWolves = s.alive.length - wolves.length;
  if (wolves.length >= nonWolves) return { ended: true, winner: 'werewolves' };
  return { ended: false };
}

export function planNextTurn(s: WerewolfState): TurnPlan | null {
  if (s.phase === 'ended') return null;

  if (s.phase === 'night-werewolf') {
    const wolves = liveByRole(s, 'werewolf');
    const actor = wolves[0];
    if (!actor) {
      // Should be impossible (checkWin would have ended the game), but defend.
      return { phase: 'night-resolve', kind: 'system', actorTwinId: null, visibility: 'public', systemText: 'No werewolves remain.' };
    }
    return { phase: 'night-werewolf', kind: 'kill', actorTwinId: actor, visibility: [actor] };
  }

  if (s.phase === 'night-seer') {
    const seers = liveByRole(s, 'seer');
    const actor = seers[0];
    if (!actor) {
      return { phase: 'night-resolve', kind: 'system', actorTwinId: null, visibility: 'public', systemText: 'No seer to peek.' };
    }
    return { phase: 'night-seer', kind: 'peek', actorTwinId: actor, visibility: [actor] };
  }

  if (s.phase === 'night-resolve') {
    return {
      phase: 'night-resolve',
      kind: 'system',
      actorTwinId: null,
      visibility: 'public',
      systemText: s.pendingKill
        ? `Day ${s.day + 1}: The village wakes to find a body.`
        : `Day ${s.day + 1}: No one died in the night.`,
    };
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
    return {
      phase: 'day-resolve',
      kind: 'system',
      actorTwinId: null,
      visibility: 'public',
      systemText: 'The village casts its votes.',
    };
  }

  return null;
}

function advanceAfterNightResolve(s: WerewolfState): WerewolfState {
  const next = clone(s);
  if (next.pendingKill) {
    next.alive = next.alive.filter((id) => id !== next.pendingKill);
    next.publicLog.push(`Day ${next.day + 1}: ${next.pendingKill} was found dead — killed in the night.`);
    next.pendingKill = undefined;
  } else {
    next.publicLog.push(`Day ${next.day + 1}: The village survived the night unharmed.`);
  }
  const win = checkWin(next);
  if (win.ended) {
    next.phase = 'ended';
    next.winner = win.winner as 'werewolves' | 'villagers';
    return next;
  }
  next.phase = 'day-speak';
  next.cursor = 0;
  return next;
}

function advanceAfterDayResolve(s: WerewolfState): WerewolfState {
  const next = clone(s);
  // Tally pendingVotes
  const tally: Record<string, number> = {};
  for (const target of Object.values(next.pendingVotes)) {
    tally[target] = (tally[target] || 0) + 1;
  }
  let max = 0;
  let winner: string | null = null;
  let tied = false;
  for (const [target, count] of Object.entries(tally)) {
    if (count > max) {
      max = count;
      winner = target;
      tied = false;
    } else if (count === max) {
      tied = true;
    }
  }
  if (winner && !tied && max > 0) {
    next.alive = next.alive.filter((id) => (id as unknown as string) !== winner);
    next.publicLog.push(`Day ${next.day + 1}: The village voted to lynch ${winner}.`);
  } else {
    next.publicLog.push(`Day ${next.day + 1}: The village deadlocked — no one was lynched.`);
  }
  next.pendingVotes = {};
  next.day += 1;
  const win = checkWin(next);
  if (win.ended) {
    next.phase = 'ended';
    next.winner = win.winner as 'werewolves' | 'villagers';
    return next;
  }
  next.phase = 'night-werewolf';
  next.cursor = 0;
  return next;
}

export function applyTurn(s: WerewolfState, t: AppliedTurn): WerewolfState {
  // night-werewolf-kill
  if (s.phase === 'night-werewolf' && t.kind === 'kill') {
    const next = clone(s);
    const target = (t.data as { target?: Id<'twins'> })?.target;
    if (target && next.alive.includes(target)) {
      next.pendingKill = target;
    }
    next.phase = liveByRole(next, 'seer').length > 0 ? 'night-seer' : 'night-resolve';
    next.cursor = 0;
    return next;
  }

  // night-seer-peek
  if (s.phase === 'night-seer' && t.kind === 'peek') {
    const next = clone(s);
    const target = (t.data as { target?: Id<'twins'> })?.target;
    const role = target ? next.roles[target as unknown as string] : undefined;
    if (target && role) {
      next.seerKnowledge.push({ target, role, day: next.day });
    }
    next.phase = 'night-resolve';
    next.cursor = 0;
    return next;
  }

  // Either night actor abstained (e.g. parse failure) — advance to next phase anyway.
  if (s.phase === 'night-werewolf' && t.kind === 'abstain') {
    const next = clone(s);
    next.phase = liveByRole(next, 'seer').length > 0 ? 'night-seer' : 'night-resolve';
    next.cursor = 0;
    return next;
  }
  if (s.phase === 'night-seer' && t.kind === 'abstain') {
    const next = clone(s);
    next.phase = 'night-resolve';
    next.cursor = 0;
    return next;
  }

  // night-resolve system turn
  if (s.phase === 'night-resolve' && t.kind === 'system') {
    return advanceAfterNightResolve(s);
  }

  // day-speak: record turn (no state mutation other than cursor); advance to day-vote on round end
  if (s.phase === 'day-speak' && (t.kind === 'speak' || t.kind === 'abstain')) {
    const next = clone(s);
    next.cursor += 1;
    if (next.cursor >= next.alive.length) {
      next.phase = 'day-vote';
      next.cursor = 0;
    }
    return next;
  }

  // day-vote
  if (s.phase === 'day-vote' && (t.kind === 'vote' || t.kind === 'abstain')) {
    const next = clone(s);
    if (t.kind === 'vote' && t.actorTwinId) {
      const target = (t.data as { target?: Id<'twins'> })?.target;
      if (target && next.alive.includes(target)) {
        next.pendingVotes[t.actorTwinId as unknown as string] = target as unknown as string;
      }
    }
    next.cursor += 1;
    if (next.cursor >= next.alive.length) {
      // All votes in — run resolve immediately so external callers don't need
      // to drive a separate system turn. Saves a round-trip and keeps the
      // smoke test simpler.
      return advanceAfterDayResolve(next);
    }
    return next;
  }

  // day-resolve system turn (idempotent — also reachable if external caller drives it)
  if (s.phase === 'day-resolve' && t.kind === 'system') {
    return advanceAfterDayResolve(s);
  }

  // No matching transition — return unchanged (defensive; planNextTurn should
  // never produce a turn that this function can't handle).
  return s;
}

// Re-export phase type for callers that want it.
export type { WerewolfPhase, WerewolfRole };
