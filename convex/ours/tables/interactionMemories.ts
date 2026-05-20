import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Per-participant post-game record. Re-added in the dungeon-bridge work
// (originally deferred in round-1). v1: simple, no embedding, not yet
// fed into ai-town's `memories` table — that integration needs embedding
// generation and is a separate task.
//
// When a dungeon-origin game ends, one row is inserted per participant
// summarizing their role + outcome. The instructor / future spectator UI
// can read these to show "what each agent remembers" of past games.
export const interactionMemories = defineTable({
  interactionId: v.id('interactions'),
  twinId: v.id('twins'),
  // For dungeon-origin games: the ai-town playerId this twin corresponds
  // to. Useful for future memory write-back into ai-town's `memories`.
  originPlayerId: v.optional(v.string()),
  // 'won' | 'lost' | 'died' | 'survived' | 'cancelled' — plugin-defined.
  outcome: v.string(),
  // 1-2 sentence summary. v1: framework-generated stub ("Played as Seer in
  // game X; outcome: won"). v2: LLM-generated post-game reflection.
  summary: v.string(),
  createdAt: v.number(),
})
  .index('by_twin', ['twinId'])
  .index('by_interaction', ['interactionId'])
  .index('by_originPlayer', ['originPlayerId']);
