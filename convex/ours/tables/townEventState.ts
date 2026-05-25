import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Singleton-per-world record of the currently-active "town event" —
// an instructor-set bit of context that gets prepended to every alive
// agent's identity, e.g. "A storm just rolled in" or "A famous magician
// arrived in town". When set, every conversation_reply call sees the
// event first in its system prompt, so the LLM reacts to the situation
// in-character.
//
// Class demo use: the instructor changes the event, the class watches
// the town's conversations shift tone within ~30 seconds.
//
// originalIdentities snapshots agentDescription.identity per agent so
// clearTownEvent can restore. New agents created AFTER setTownEvent are
// not automatically affected — they get the un-prefixed identity.
export const townEventState = defineTable({
  worldId: v.id('worlds'),
  eventText: v.string(),
  // Preset id when set via instructor festival UI (#4); omitted for legacy free-text events.
  festivalKind: v.optional(v.string()),
  setAt: v.number(),
  expiresAt: v.optional(v.number()),
  // Map of agentDescription._id (stringified) → original identity text.
  // Used by clearTownEvent to restore.
  originalIdentities: v.record(v.string(), v.string()),
}).index('by_world', ['worldId']);
