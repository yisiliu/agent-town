import type { Id } from '../../../_generated/dataModel';

// Canonical Chinese 9p (9人板子) configuration:
//   3 werewolves + 1 seer + 1 witch + 1 hunter + 3 villagers.
// Per-research recommendations: no guard, no sheriff in v1; last-words on
// lynch + wolf-kill; hunter shot blocked when poisoned by witch.
export type WerewolfRole = 'werewolf' | 'seer' | 'witch' | 'hunter' | 'villager';

export type WerewolfPhase =
  // Wolves vote on a target privately (each wolf picks; majority wins;
  // tie → lowest-seat wolf decides).
  | 'night-werewolf'
  // Seer peeks one player.
  | 'night-seer'
  // Witch acts: optional save on tonight's kill target, optional poison
  // on any player. Same night can use either but not both (per canonical
  // rules). One-shot per potion.
  | 'night-witch'
  // System: apply pending kill/save/poison. If hunter died (and wasn't
  // poisoned), enter 'hunter-shoot' phase. Else go to last-words for any
  // newly-dead player who has a last-words slot.
  | 'night-resolve'
  // A dead hunter chooses one player to shoot down with them. Only enters
  // when hunter death was not by poison.
  | 'hunter-shoot'
  // A newly-dead player gets one public statement before being removed
  // from `alive` list. Visible to all. Werewolves use this to claim
  // special roles + misdirect; seers/witches can credibly out themselves.
  | 'last-words'
  // Each alive player speaks once per day (fixed seat order in v1).
  | 'day-speak'
  // Each alive player votes once.
  | 'day-vote'
  // System: tally, apply lynch (last-words + maybe hunter-shoot enter
  // before day flips to night).
  | 'day-resolve'
  | 'ended';

export type WolfTeamVote = { voterId: Id<'twins'>; targetId: Id<'twins'> };

// Hidden persona traits — never revealed publicly. Per wolfcha research:
// fixed 6-axis player-mind enables behavior heterogeneity. Generated at
// game start (deterministic via Mulberry32 seed) and threaded into every
// agent's system prompt inside <hidden_player_mind>.
export interface HiddenMind {
  // 1=低 .. 5=高: willingness to lead the vote / out themselves / push hard
  courage: number;
  // 1=低 .. 5=高: speed at which they form & express suspicion
  suspicion_threshold: number;
  // 1=低 .. 5=高: how strongly they prioritize personal survival vs winning
  self_preservation: number;
  // 1=低 .. 5=高: how logical / how vibe-based their reads are
  logic: number;
  // 1=低 .. 5=高: how often they speak vs lurk
  table_presence: number;
}

export interface WerewolfState {
  // Seat order — index into participants[] is the seat number.
  participants: Id<'twins'>[];
  roles: Record<string, WerewolfRole>;
  alive: Id<'twins'>[]; // seat-ordered
  hiddenMinds: Record<string, HiddenMind>;
  phase: WerewolfPhase;

  // ---- night state ----
  // Per-wolf votes for tonight's kill target. Cleared each night.
  wolfVotes: Record<string, string>; // wolfId → targetId
  // After night-werewolf collapses wolfVotes to a single target.
  pendingWolfKill?: Id<'twins'>;
  // Set by witch during night-witch; clears pendingWolfKill if used.
  witchSaveUsedTonight: boolean;
  // Set by witch during night-witch; queues a poison kill for resolve.
  pendingPoisonTarget?: Id<'twins'>;
  // Witch potions remaining (1 each at game start).
  witchSavePotion: boolean;
  witchPoisonPotion: boolean;
  // Tracks deaths-this-night for the hunter-shoot phase.
  nightDeaths: Id<'twins'>[];
  // Whether a death was by poison (hunter shot is blocked on poisoned death).
  poisonedThisNight: Id<'twins'>[];

  // ---- last-words / hunter-shoot queue ----
  // Players queued for last-words. The phase pops one each turn.
  lastWordsQueue: Id<'twins'>[];
  // Hunter who must shoot (set when a hunter dies non-poisoned).
  pendingHunterShot?: Id<'twins'>;

  // ---- day state ----
  cursor: number; // index into alive[] for day-speak / day-vote
  pendingVotes: Record<string, string>; // voterId → targetId

  // ---- logs / private knowledge ----
  publicLog: string[];
  // Per-player private notes are surfaced through visibility-restricted
  // turns rather than state — keeps the state shape stable.
  seerKnowledge: Array<{ target: Id<'twins'>; role: WerewolfRole; day: number }>;

  day: number;
  winner?: 'werewolves' | 'villagers';
}
