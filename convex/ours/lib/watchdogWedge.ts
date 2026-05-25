// Pure detector for a "wedged but running" town: the engine ticks
// (generationNumber advances) but every agent is stuck on a stale
// `inProgressOperation` — so `agent.tick` skips them all (they look busy),
// nobody starts a conversation or moves, and the town sits inert with 0
// conversations. This happens when in-flight `agentDoSomething` actions are
// killed (e.g. by a `convex deploy` / platform restart): every agent is left
// with inProgressOperation set. ai-town clears these only after ACTION_TIMEOUT
// of SIMULATED time (agent.tick), which at the frozen pace advances far too
// slowly to fire — so the wedge never self-heals. The watchdog uses this to
// trigger a stop+start, whose `startEngine` jumps currentTime to now and makes
// the stale ops clear immediately.
//
// Signal: EVERY agent (of a non-empty set) holds an inProgressOperation. In a
// healthy town ops complete + clear within seconds, so they never ALL stay set
// — and the watchdog additionally requires this to persist across 2 checks
// before acting, guarding against a transient all-busy moment.
export function isTownWedged(
  agents: ReadonlyArray<{ inProgressOperation?: unknown }>,
): boolean {
  if (agents.length === 0) return false;
  return agents.every((a) => a.inProgressOperation !== undefined);
}
