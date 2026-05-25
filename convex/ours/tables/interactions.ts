import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Generic interactions table — backs the plugin framework defined under
// convex/ours/interactions/. The plugin owns the shape of `state`; the
// framework treats it as transparent JSON. Renamed/generalized from the
// unused decrypto-specific `games` table.
export const interactions = defineTable({
  type: v.string(),
  status: v.union(
    v.literal('lobby'),
    // 'gathering' = dungeon game created, pulling its agents in (waiting for
    // any mid-conversation to finish) before turns start. Flips to
    // 'in_progress' once pendingPlayerIds is empty. The turn machinery
    // no-ops while not 'in_progress', so turns naturally wait.
    v.literal('gathering'),
    v.literal('in_progress'),
    v.literal('ended'),
  ),
  participants: v.array(v.id('twins')),
  state: v.any(),
  turnIndex: v.number(),
  phase: v.string(),
  // Last successful tick — cron dedup.
  lastTickAt: v.number(),
  // Set when a takeTurn action is scheduled; cleared when it appends or
  // errors. Prevents the cron from double-scheduling while an action runs.
  inflightSince: v.optional(v.number()),
  seed: v.number(),
  startedAt: v.number(),
  endedAt: v.optional(v.number()),
  // Plugin-defined; werewolf uses 'werewolves' | 'villagers'.
  winner: v.optional(v.string()),
  // ---- Dungeon bridge (links a game back to an ai-town world) ----
  // 'standalone' = launched directly via startInteraction (test / dev path).
  // 'dungeon'    = launched from ai-town via startDungeonGame; the players
  //                are real ai-town agents. Memory write-back on game end
  //                routes through this.
  originType: v.optional(v.union(v.literal('standalone'), v.literal('dungeon'))),
  // For dungeon-origin games: which ai-town world spawned this.
  worldId: v.optional(v.id('worlds')),
  // For dungeon-origin games: the ai-town playerIds parallel to `participants`
  // (twin IDs). Same length, same index correspondence — participants[i] is
  // the twin for originPlayerIds[i]'s ai-town agent.
  originPlayerIds: v.optional(v.array(v.string())),
  // ---- Gathering phase (dungeon borrow, conversation-aware) ----
  // ai-town playerIds not yet pulled into the game (still being gathered).
  // Drained by gatherStep as each agent becomes conversation-free; when
  // empty the game flips to 'in_progress'.
  pendingPlayerIds: v.optional(v.array(v.string())),
  // When the gathering phase started — drives the 30s force-leave deadline.
  gatheringStartedAt: v.optional(v.number()),
})
  .index('by_status_and_lastTickAt', ['status', 'lastTickAt'])
  .index('by_type', ['type']);
