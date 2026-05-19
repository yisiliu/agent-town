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
})
  .index('by_status_and_lastTickAt', ['status', 'lastTickAt'])
  .index('by_type', ['type']);
