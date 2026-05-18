import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// One row per registered WebAuthn credential. An instructor can register
// multiple devices (phone + hardware key recommended in v1). The counter
// rotates on every assertion — a replay would carry an old counter and
// be rejected on completeInstructorAuthentication.
export const instructorAuthenticators = defineTable({
  instructorId: v.id('instructors'),
  credentialId: v.string(),
  credentialPublicKey: v.bytes(),
  counter: v.number(),
  deviceType: v.union(v.literal('singleDevice'), v.literal('multiDevice')),
  backedUp: v.boolean(),
  transports: v.optional(v.array(v.string())),
  nickname: v.optional(v.string()),
  registeredAt: v.number(),
})
  .index('instructorId', ['instructorId'])
  .index('credentialId', ['credentialId']);
