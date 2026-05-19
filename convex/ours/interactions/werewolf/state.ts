import type { Id } from '../../../_generated/dataModel';

export type WerewolfRole = 'werewolf' | 'seer' | 'villager';

export type WerewolfPhase =
  | 'night-werewolf'
  | 'night-seer'
  | 'night-resolve'
  | 'day-speak'
  | 'day-vote'
  | 'day-resolve'
  | 'ended';

export interface WerewolfState {
  participants: Id<'twins'>[];
  roles: Record<string, WerewolfRole>;
  alive: Id<'twins'>[];
  phase: WerewolfPhase;
  // For per-player phases (day-speak, day-vote, occasionally night-werewolf
  // in future multi-werewolf variants): index into `alive` of the next actor.
  cursor: number;
  // day-vote in progress: voterId → targetId.
  pendingVotes: Record<string, string>;
  // night-werewolf result, applied at night-resolve.
  pendingKill?: Id<'twins'>;
  // Surfaced in user prompts.
  publicLog: string[];
  // Seer-only knowledge.
  seerKnowledge: Array<{ target: Id<'twins'>; role: WerewolfRole; day: number }>;
  day: number;
  winner?: 'werewolves' | 'villagers';
}
