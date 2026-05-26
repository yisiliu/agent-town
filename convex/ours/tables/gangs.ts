import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Gang invitations - track pending invites
export const gangInvites = defineTable({
  gangId: v.id('gangs'),
  inviterId: v.string(), // who sent the invite
  inviteeId: v.string(), // who received the invite
  status: v.union(v.literal('pending'), v.literal('accepted'), v.literal('rejected')),
  createdAt: v.number(),
})
  .index('gangId', ['gangId'])
  .index('inviteeId', ['inviteeId'])
  .index('inviterId', ['inviterId']);

export const gangs = defineTable({
  name: v.string(),
  motto: v.string(),
  founderId: v.string(),
  worldId: v.id('worlds'),
  createdAt: v.number(),
})
  .index('worldId', ['worldId']);

export const gangMembers = defineTable({
  gangId: v.id('gangs'),
  playerId: v.string(),
  joinedAt: v.number(),
})
  .index('gangId', ['gangId'])
  .index('playerId', ['playerId']);

export const gangMessages = defineTable({
  gangId: v.id('gangs'),
  senderId: v.string(),
  content: v.string(),
  createdAt: v.number(),
})
  .index('gangId', ['gangId']);
