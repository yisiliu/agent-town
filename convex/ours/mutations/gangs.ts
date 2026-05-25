import { v } from 'convex/values';
import { mutation } from '../../_generated/server';

// Create a new gang. Checks for name collision in the same world,
// then inserts the gang and adds the founder as the first member.
export const createGang = mutation({
  args: {
    name: v.string(),
    motto: v.string(),
    worldId: v.id('worlds'),
    founderId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check for duplicate name in the same world
    const existing = await ctx.db
      .query('gangs')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .filter((q) => q.eq(q.field('name'), args.name))
      .first();

    if (existing) {
      return { error: 'gang name already exists in this world' as const };
    }

    // Insert the gang
    const gangId = await ctx.db.insert('gangs', {
      name: args.name,
      motto: args.motto,
      founderId: args.founderId,
      worldId: args.worldId,
      createdAt: now,
    });

    // Add founder as the first member
    await ctx.db.insert('gangMembers', {
      gangId,
      playerId: args.founderId,
      joinedAt: now,
    });

    return { gangId };
  },
});

// Join an existing gang. Idempotent: returns success if already a member.
export const joinGang = mutation({
  args: {
    gangId: v.id('gangs'),
    playerId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Verify the gang exists
    const gang = await ctx.db.get(args.gangId);
    if (!gang) {
      return { error: 'gang not found' as const };
    }

    // Check if already a member
    const existing = await ctx.db
      .query('gangMembers')
      .withIndex('gangId', (q) => q.eq('gangId', args.gangId))
      .filter((q) => q.eq(q.field('playerId'), args.playerId))
      .first();

    if (existing) {
      return { success: true, alreadyMember: true as const };
    }

    // Insert new member
    await ctx.db.insert('gangMembers', {
      gangId: args.gangId,
      playerId: args.playerId,
      joinedAt: now,
    });

    return { success: true, alreadyMember: false as const };
  },
});

// Leave a gang. Deletes the member record if it exists.
export const leaveGang = mutation({
  args: {
    gangId: v.id('gangs'),
    playerId: v.string(),
  },
  handler: async (ctx, args) => {
    // Find the member record
    const member = await ctx.db
      .query('gangMembers')
      .withIndex('gangId', (q) => q.eq('gangId', args.gangId))
      .filter((q) => q.eq(q.field('playerId'), args.playerId))
      .first();

    if (!member) {
      return { error: 'not a member of this gang' as const };
    }

    // Delete the member record
    await ctx.db.delete(member._id);

    return { success: true };
  },
});

// Send a message to a gang. Only members can send messages.
export const sendGangMessage = mutation({
  args: {
    gangId: v.id('gangs'),
    senderId: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Verify the gang exists
    const gang = await ctx.db.get(args.gangId);
    if (!gang) {
      return { error: 'gang not found' as const };
    }

    // Verify sender is a member
    const member = await ctx.db
      .query('gangMembers')
      .withIndex('gangId', (q) => q.eq('gangId', args.gangId))
      .filter((q) => q.eq(q.field('playerId'), args.senderId))
      .first();

    if (!member) {
      return { error: 'only gang members can send messages' as const };
    }

    // Insert the message
    const messageId = await ctx.db.insert('gangMessages', {
      gangId: args.gangId,
      senderId: args.senderId,
      content: args.content,
      createdAt: now,
    });

    return { messageId };
  },
});

// Invite a player to join a gang. Only members can invite.
export const inviteToGang = mutation({
  args: {
    gangId: v.id('gangs'),
    inviterId: v.string(),
    inviteeId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Verify the gang exists
    const gang = await ctx.db.get(args.gangId);
    if (!gang) {
      return { error: 'gang not found' as const };
    }

    // Verify inviter is a member
    const inviterMember = await ctx.db
      .query('gangMembers')
      .withIndex('gangId', (q) => q.eq('gangId', args.gangId))
      .filter((q) => q.eq(q.field('playerId'), args.inviterId))
      .first();

    if (!inviterMember) {
      return { error: 'only gang members can invite' as const };
    }

    // Check if invitee is already a member
    const existingMember = await ctx.db
      .query('gangMembers')
      .withIndex('gangId', (q) => q.eq('gangId', args.gangId))
      .filter((q) => q.eq(q.field('playerId'), args.inviteeId))
      .first();

    if (existingMember) {
      return { error: 'player is already a member' as const };
    }

    // Check for existing pending invite
    const existingInvites = await ctx.db
      .query('gangInvites')
      .withIndex('inviteeId', (q) => q.eq('inviteeId', args.inviteeId))
      .filter((q) => q.eq(q.field('gangId'), args.gangId))
      .collect();
    const existingInvite = existingInvites.find(i => i.status === 'pending');

    if (existingInvite) {
      return { error: 'invite already pending' as const };
    }

    // Create the invite
    const inviteId = await ctx.db.insert('gangInvites', {
      gangId: args.gangId,
      inviterId: args.inviterId,
      inviteeId: args.inviteeId,
      status: 'pending',
      createdAt: now,
    });

    return { inviteId };
  },
});

// Accept a gang invitation
export const acceptGangInvite = mutation({
  args: {
    inviteId: v.id('gangInvites'),
    playerId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get the invite
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) {
      return { error: 'invite not found' as const };
    }

    // Verify the player is the invitee
    if (invite.inviteeId !== args.playerId) {
      return { error: 'not your invite' as const };
    }

    // Check if already processed
    if (invite.status !== 'pending') {
      return { error: 'invite already processed' as const };
    }

    // Check if already a member
    const existingMember = await ctx.db
      .query('gangMembers')
      .withIndex('gangId', (q) => q.eq('gangId', invite.gangId))
      .filter((q) => q.eq(q.field('playerId'), args.playerId))
      .first();

    if (existingMember) {
      // Update invite status and return success
      await ctx.db.patch(invite._id, { status: 'accepted' });
      return { success: true, alreadyMember: true as const };
    }

    // Add member
    await ctx.db.insert('gangMembers', {
      gangId: invite.gangId,
      playerId: args.playerId,
      joinedAt: now,
    });

    // Update invite status
    await ctx.db.patch(invite._id, { status: 'accepted' });

    return { success: true, alreadyMember: false as const };
  },
});

// Reject a gang invitation
export const rejectGangInvite = mutation({
  args: {
    inviteId: v.id('gangInvites'),
    playerId: v.string(),
  },
  handler: async (ctx, args) => {
    // Get the invite
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) {
      return { error: 'invite not found' as const };
    }

    // Verify the player is the invitee
    if (invite.inviteeId !== args.playerId) {
      return { error: 'not your invite' as const };
    }

    // Check if already processed
    if (invite.status !== 'pending') {
      return { error: 'invite already processed' as const };
    }

    // Update invite status
    await ctx.db.patch(invite._id, { status: 'rejected' });

    return { success: true };
  },
});

// Kick a member from a gang. Only the founder can kick members.
export const kickGangMember = mutation({
  args: {
    gangId: v.id('gangs'),
    founderId: v.string(),
    memberId: v.string(),
  },
  handler: async (ctx, args) => {
    // Verify the gang exists
    const gang = await ctx.db.get(args.gangId);
    if (!gang) {
      return { error: 'gang not found' as const };
    }

    // Verify the requester is the founder
    if (gang.founderId !== args.founderId) {
      return { error: 'only founder can kick members' as const };
    }

    // Cannot kick yourself
    if (args.founderId === args.memberId) {
      return { error: 'cannot kick yourself' as const };
    }

    // Find the member record
    const member = await ctx.db
      .query('gangMembers')
      .withIndex('gangId', (q) => q.eq('gangId', args.gangId))
      .filter((q) => q.eq(q.field('playerId'), args.memberId))
      .first();

    if (!member) {
      return { error: 'not a member of this gang' as const };
    }

    // Delete the member record
    await ctx.db.delete(member._id);

    return { success: true };
  },
});
