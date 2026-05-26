import { v } from 'convex/values';
import { query } from '../../_generated/server';

// List all gangs in a world.
export const listGangs = query({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const gangs = await ctx.db
      .query('gangs')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();

    return gangs;
  },
});

// Get detailed info about a gang, including members and recent messages.
export const getGangDetail = query({
  args: {
    gangId: v.id('gangs'),
  },
  handler: async (ctx, args) => {
    // Get gang details
    const gang = await ctx.db.get(args.gangId);
    if (!gang) {
      return null;
    }

    // Get all members
    const members = await ctx.db
      .query('gangMembers')
      .withIndex('gangId', (q) => q.eq('gangId', args.gangId))
      .collect();

    // Get recent 50 messages, ordered by time
    const messages = await ctx.db
      .query('gangMessages')
      .withIndex('gangId', (q) => q.eq('gangId', args.gangId))
      .order('desc')
      .take(50);

    return {
      ...gang,
      members,
      messages: messages.reverse(), // Reverse to get chronological order
    };
  },
});

// Get all gangs that a player belongs to.
export const getPlayerGangs = query({
  args: {
    playerId: v.string(),
  },
  handler: async (ctx, args) => {
    // Find all gang memberships for this player
    const memberships = await ctx.db
      .query('gangMembers')
      .withIndex('playerId', (q) => q.eq('playerId', args.playerId))
      .collect();

    // Get full gang details for each membership
    const gangs = await Promise.all(
      memberships.map(async (membership) => {
        const gang = await ctx.db.get(membership.gangId);
        if (!gang) return null;
        return {
          gang,
          joinedAt: membership.joinedAt,
        };
      })
    );

    // Filter out nulls (in case a gang was deleted)
    return gangs.filter((g): g is NonNullable<typeof g> => g !== null);
  },
});

// Get all players in the world with their gang status
export const listAllPlayersWithGangStatus = query({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    // Get all gangs in this world
    const gangs = await ctx.db
      .query('gangs')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();

    // Build a map of playerId -> gang info
    const playerGangMap = new Map<string, { gangId: string; gangName: string; isFounder: boolean }>();

    for (const gang of gangs) {
      const members = await ctx.db
        .query('gangMembers')
        .withIndex('gangId', (q) => q.eq('gangId', gang._id))
        .collect();

      for (const member of members) {
        playerGangMap.set(member.playerId, {
          gangId: gang._id,
          gangName: gang.name,
          isFounder: member.playerId === gang.founderId,
        });
      }
    }

    // For now, return mock AI player data
    // In production, this would query the actual players/agents table
    const mockPlayers = [
      { id: 'a:1', name: 'Alice', isAI: true },
      { id: 'a:2', name: 'Bob', isAI: true },
      { id: 'a:3', name: 'Stella', isAI: true },
      { id: 'a:4', name: 'Pete', isAI: true },
    ];

    return mockPlayers.map((player) => {
      const gangInfo = playerGangMap.get(player.id);
      return {
        ...player,
        gangInfo: gangInfo || null,
      };
    });
  },
});

// Get pending invites for a player
export const getPendingInvites = query({
  args: {
    playerId: v.string(),
  },
  handler: async (ctx, args) => {
    const invites = await ctx.db
      .query('gangInvites')
      .withIndex('inviteeId', (q) => q.eq('inviteeId', args.playerId))
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .collect();

    // Enrich with gang info
    const enrichedInvites = await Promise.all(
      invites.map(async (invite) => {
        const gang = await ctx.db.get(invite.gangId);
        return {
          ...invite,
          gangName: gang?.name || 'Unknown Gang',
        };
      })
    );

    return enrichedInvites;
  },
});
