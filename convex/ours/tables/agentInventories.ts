import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Per-agent inventory — tracks how many of each item an agent owns
// Uses array format instead of Map to avoid non-ASCII key issue (AGENTS.md §7.5)
// playerId is stored as string (game-format like "p:0") matching game.world.players keys
export const agentInventories = defineTable({
  worldId: v.id('worlds'),
  playerId: v.string(),
  // Array of {itemId, count} — NOT a Map (Convex can't serialize Map with non-ASCII keys)
  items: v.array(
    v.object({
      itemId: v.id('itemDefinitions'),
      count: v.number(),
    })
  ),
})
  .index('worldId', ['worldId'])
  .index('playerId', ['playerId'])
  .index('worldAndPlayer', ['worldId', 'playerId']);