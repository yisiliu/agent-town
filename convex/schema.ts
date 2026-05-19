import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { ourTables } from './ours/tables';
import { aiTownTables } from './aiTown/schema';
import { agentTables } from './agent/schema';
import { engineTables } from './engine/schema';
import { conversationId, playerId } from './aiTown/ids';

// Composed schema: our additive tables PLUS ai-town's vendored
// runtime tables. The ai-town subtree is synced from
// ai-town-fork/convex/ via scripts/sync-ai-town.sh — see that
// script's header for what's pulled in.
//
// `music` and `messages` live inline in ai-town-fork's top-level
// schema.ts (we don't sync that file because it'd collide with this
// one); replicated here verbatim so the runtime can find them.
export default defineSchema({
  music: defineTable({
    storageId: v.string(),
    type: v.union(v.literal('background'), v.literal('player')),
  }),

  messages: defineTable({
    conversationId,
    messageUuid: v.string(),
    author: playerId,
    text: v.string(),
    worldId: v.optional(v.id('worlds')),
  })
    .index('conversationId', ['worldId', 'conversationId'])
    .index('messageUuid', ['conversationId', 'messageUuid']),

  ...agentTables,
  ...aiTownTables,
  ...engineTables,
  ...ourTables,
});
