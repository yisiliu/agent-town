// Pure detector for a town that is "running but inert": the engine ticks
// (generationNumber advances) yet NObody is conversing and NObody is moving.
// This is the user-visible symptom of "all conversations stopped".
//
// It happens after a disruption — a `convex deploy` / platform restart kills
// in-flight `agentDoSomething` actions, leaving agents stuck on stale
// `inProgressOperation`s. ai-town only clears those after ACTION_TIMEOUT (120s)
// of SIMULATED time (agent.tick); at the frozen pace the sim advances too
// slowly to fire it, so the town never re-establishes activity on its own. The
// recovery is a stop+start: `startEngine` jumps `currentTime` to now, which
// clears the stale ops on the next tick and lets agents re-fire (verified to
// un-stick a frozen prod town: 0→11 moving, 0→5 conversations).
//
// We key on the SYMPTOM (no conversations AND no movement) rather than the
// specific "all agents wedged" cause, because a partial wedge can also leave
// the town inert. A healthy town — even frozen — almost always has someone
// conversing or wandering, and the watchdog additionally requires this to hold
// across 2 consecutive checks (~2 min) before acting, so a momentary lull
// won't trip it (and a false stop+start is harmless).
export function isTownInert(world: {
  conversations: ReadonlyArray<unknown>;
  players: ReadonlyArray<{ pathfinding?: unknown }>;
}): boolean {
  if (world.players.length === 0) return false; // no town to recover
  if (world.conversations.length > 0) return false; // someone's talking
  if (world.players.some((p) => p.pathfinding !== undefined)) return false; // someone's moving
  return true;
}
