// Pure detector for a town that is "running but inert": the engine ticks
// (generationNumber advances) yet no conversation is happening. This is the
// user-visible symptom of "all conversations stopped".
//
// It happens after a disruption — a `convex deploy` / platform restart kills
// in-flight `agentDoSomething` actions, leaving agents stuck on stale
// `inProgressOperation`s. ai-town only clears those after ACTION_TIMEOUT (120s)
// of SIMULATED time (agent.tick); at the frozen pace the sim advances too
// slowly to fire it, so the town never re-establishes conversation on its own.
// The recovery is a stop+start: `startEngine` jumps `currentTime` to now, which
// clears the stale ops on the next tick and lets agents re-fire (verified to
// un-stick a frozen prod town: 0→11 moving, 0→5 conversations).
//
// Signal = ZERO active conversations. We deliberately do NOT also require "no
// movement": a wedged agent fires failing `moveTo` ops that set `pathfinding`
// transiently, so a movement check flickers and would keep resetting the
// watchdog's consecutive-check counter. Conversations are the stable signal —
// a healthy town (even frozen) essentially always has someone conversing, and
// the watchdog requires this to hold across 3 consecutive checks (~3 min)
// before acting, so a brief lull won't trip it (and a false stop+start is
// harmless — it just re-kicks a healthy engine).
export function isTownInert(world: {
  conversations: ReadonlyArray<unknown>;
  players: ReadonlyArray<unknown>;
}): boolean {
  if (world.players.length === 0) return false; // no town to recover
  return world.conversations.length === 0;
}
