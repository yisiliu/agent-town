import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { insertInput } from '../../aiTown/insertInput';
import { nextGatherAction } from '../interactions/gather';
import { restoreDungeonPlayers } from '../interactions/restore';

// One atomic tick of the dungeon "gathering" phase. For each still-pending
// ai-town player: pull them in now if they're conversation-free, wait if
// they're mid-conversation (within the 30s grace), or force them out and pull
// them past the grace. When pending drains the game flips to 'in_progress';
// otherwise it reschedules itself. A pending player that has vanished from
// world.players cancels the whole game (we can't run with a missing seat).
const GATHER_RETRY_MS = 3_000;

export default internalMutation({
  args: { interactionId: v.id('interactions') },
  handler: async (ctx, args) => {
    const inter = await ctx.db.get(args.interactionId);
    if (!inter || inter.status !== 'gathering') return;
    if (!inter.worldId) return;
    const world = await ctx.db.get(inter.worldId);
    if (!world) return;

    const now = Date.now();
    const conversations = world.conversations.map(
      (c: { id: string; participants: { playerId: string }[] }) => ({
        id: c.id,
        participants: c.participants,
      }),
    );

    const pending = inter.pendingPlayerIds ?? [];
    const survivors: string[] = [];

    for (const pid of pending) {
      const player = world.players.find((p) => p.id === pid);
      if (!player) {
        // The seat vanished — restore anyone we already pulled and cancel.
        await restoreDungeonPlayers(ctx, args.interactionId, inter.worldId);
        await ctx.db.patch(args.interactionId, {
          status: 'ended' as const,
          endedAt: now,
          winner: 'cancelled',
          inflightSince: undefined,
        });
        return;
      }

      const action = nextGatherAction(
        pid,
        conversations,
        inter.gatheringStartedAt!,
        now,
      );

      if (action.kind === 'wait') {
        survivors.push(pid);
        continue;
      }

      if (action.kind === 'forceLeave') {
        // Leave first (lower input number) so the engine drops them from the
        // conversation before the teleport lands.
        await insertInput(ctx, inter.worldId, 'leaveConversation', {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          playerId: pid as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          conversationId: action.conversationId as any,
        });
      }

      // pull (or post-forceLeave): snapshot current spot, then teleport off-map.
      await ctx.db.insert('dungeonReturnState', {
        interactionId: args.interactionId,
        worldId: inter.worldId,
        playerId: pid,
        savedPosition: { x: player.position.x, y: player.position.y },
        savedFacing: { dx: player.facing.dx, dy: player.facing.dy },
        enteredAt: now,
      });
      await insertInput(ctx, inter.worldId, 'teleportPlayer', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        playerId: pid as any,
        position: { x: -9999, y: -9999 },
        facing: { dx: player.facing.dx, dy: player.facing.dy },
      });
    }

    if (survivors.length === 0) {
      await ctx.db.patch(args.interactionId, {
        status: 'in_progress' as const,
        pendingPlayerIds: [],
        lastTickAt: now,
        inflightSince: undefined,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.ours.actions.interactionTakeTurn.default,
        { interactionId: args.interactionId, chainCount: 0 },
      );
    } else {
      await ctx.db.patch(args.interactionId, {
        pendingPlayerIds: survivors,
        lastTickAt: now,
        inflightSince: undefined,
      });
      await ctx.scheduler.runAfter(
        GATHER_RETRY_MS,
        internal.ours.mutations.gatherStep.default,
        { interactionId: args.interactionId },
      );
    }
  },
});
