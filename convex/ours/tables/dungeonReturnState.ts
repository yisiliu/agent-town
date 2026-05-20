import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// When an ai-town agent enters a dungeon (board game), their position +
// facing get snapshotted here so we can teleport them back to the same
// spot when the game ends. The row is deleted once restoration runs.
//
// Why a separate table (vs. extending serializedPlayer): keeping ai-town's
// schema untouched means no patches/ work, no sync-script changes, and a
// clean revert path if the bridge needs surgery later.
export const dungeonReturnState = defineTable({
  interactionId: v.id('interactions'),
  worldId: v.id('worlds'),
  // ai-town playerId (custom string from world.players[].id, NOT a Convex doc id).
  playerId: v.string(),
  savedPosition: v.object({ x: v.number(), y: v.number() }),
  savedFacing: v.object({ dx: v.number(), dy: v.number() }),
  enteredAt: v.number(),
})
  .index('by_interaction', ['interactionId'])
  .index('by_player', ['worldId', 'playerId']);
