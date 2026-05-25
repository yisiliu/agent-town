// Pure decision helper for the dungeon "gathering" phase: given a pending
// ai-town player and the current conversations, decide whether to pull them
// into the game now, wait for their conversation to finish, or (past the
// 30s grace) force them out of it. The "player missing from world.players"
// case is handled by the caller (gatherStep) before this runs.
export const GATHER_FORCE_MS = 30_000;

type Conv = { id: string; participants: { playerId: string }[] };

export type GatherAction =
  | { kind: 'pull' }
  | { kind: 'wait' }
  | { kind: 'forceLeave'; conversationId: string };

export function nextGatherAction(
  playerId: string,
  conversations: Conv[],
  gatheringStartedAt: number,
  now: number,
): GatherAction {
  const conv = conversations.find((c) =>
    c.participants.some((m) => m.playerId === playerId),
  );
  if (!conv) return { kind: 'pull' };
  if (now - gatheringStartedAt < GATHER_FORCE_MS) return { kind: 'wait' };
  return { kind: 'forceLeave', conversationId: conv.id };
}
