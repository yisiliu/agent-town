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
})
  .index('by_status_and_lastTickAt', ['status', 'lastTickAt'])
  .index('by_type', ['type']);
