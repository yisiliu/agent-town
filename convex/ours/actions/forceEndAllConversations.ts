import { action, internalMutation, internalQuery } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { v } from 'convex/values';
import { insertInput } from '../../aiTown/insertInput';
import type { Id } from '../../_generated/dataModel';

// Emergency: kick every live conversation in the default world. For
// each conversation, issue a `leaveConversation` input for every
// participant — engine processes the leaves on the next tick and the
// conversation cleans itself up. Use when the town gets stuck because
// someone is locked mid-conversation (typically the human player).

interface ConvPair {
  conversationId: string;
  playerIds: string[];
}

export const listLiveConversations = internalQuery({
  args: {},
  handler: async (ctx) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return { worldId: null, conversations: [] as ConvPair[] };
    const world = await ctx.db
      .query('worlds')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((q: any) => q.eq(q.field('_id'), status.worldId))
      .first();
    if (!world) return { worldId: status.worldId as unknown as string, conversations: [] };
    const conversations: ConvPair[] = world.conversations.map((c: { id: string; participants: { playerId: string }[] }) => ({
      conversationId: c.id,
      playerIds: c.participants.map((p) => p.playerId),
    }));
    return {
      worldId: status.worldId as unknown as string,
      conversations,
    };
  },
});

export const leaveConvForPlayer = internalMutation({
  args: { worldId: v.id('worlds'), playerId: v.string(), conversationId: v.string() },
  handler: async (ctx, args) => {
    return await insertInput(ctx, args.worldId, 'leaveConversation', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      playerId: args.playerId as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      conversationId: args.conversationId as any,
    });
  },
});

/* eslint-disable @typescript-eslint/no-explicit-any */
export default action({
  args: {},
  handler: async (ctx): Promise<{ leavesIssued: number; conversations: number }> => {
    const { worldId, conversations } = (await ctx.runQuery(
      internal.ours.actions.forceEndAllConversations.listLiveConversations as any,
      {},
    )) as { worldId: string | null; conversations: ConvPair[] };

    if (!worldId) return { leavesIssued: 0, conversations: 0 };

    let leavesIssued = 0;
    for (const conv of conversations) {
      for (const pid of conv.playerIds) {
        try {
          await ctx.runMutation(
            internal.ours.actions.forceEndAllConversations.leaveConvForPlayer as any,
            {
              worldId: worldId as unknown as Id<'worlds'>,
              playerId: pid,
              conversationId: conv.conversationId,
            },
          );
          leavesIssued++;
        } catch {
          // already left / already gone — keep going
        }
      }
    }

    return { leavesIssued, conversations: conversations.length };
  },
});
