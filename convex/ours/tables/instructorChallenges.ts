import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Short-lived (5 min) WebAuthn challenges bridging the two-step ceremony
// between options-issue and response-verify. Keyed by (username, ceremony)
// so a fresh begin* call always replaces the prior challenge — no chance
// of stale-challenge confusion across retries.
export const instructorChallenges = defineTable({
  username: v.string(),
  ceremony: v.union(v.literal('register'), v.literal('authenticate')),
  challenge: v.string(),
  issuedAt: v.number(),
  expiresAt: v.number(),
})
  .index('username_ceremony', ['username', 'ceremony']);
