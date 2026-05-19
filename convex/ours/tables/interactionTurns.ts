import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Append-only turn log. Plugins interpret `kind`/`data`; the framework just
// records and surfaces visibility-filtered slices to prompt builders.
export const interactionTurns = defineTable({
  interactionId: v.id('interactions'),
  turnIndex: v.number(),
  phase: v.string(),
  // `undefined` for system turns (deal cards, resolve votes, etc.).
  actorTwinId: v.optional(v.id('twins')),
  // Plugin-defined: 'speak' | 'vote' | 'kill' | 'peek' | 'system' | 'abstain'.
  kind: v.string(),
  // For agent turns: the LLM's `reasoning` field. For system turns: framework
  // text. Spectator-visible only when visibility==='public'.
  text: v.string(),
  // Structured payload (e.g., { target: <twinId> }).
  data: v.optional(v.any()),
  // 'public' = everyone (spectators + all agents) sees it.
  // Array = whitelist of twinIds who may see it (e.g., werewolf night-kill
  // is private to the werewolf until day-resolve writes a public log line).
  visibility: v.union(v.literal('public'), v.array(v.id('twins'))),
  timestamp: v.number(),
})
  .index('by_interaction_and_turnIndex', ['interactionId', 'turnIndex'])
  .index('by_actor', ['actorTwinId']);
