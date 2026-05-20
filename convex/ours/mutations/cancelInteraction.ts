import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';

// Dev helper: force an interaction to status='ended'. Used to stop a runaway
// or stuck game during live testing. Not part of the v1 production surface;
// the eventual instructor UI will replace this.
export default internalMutation({
  args: {
    interactionId: v.id('interactions'),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const inter = await ctx.db.get(args.interactionId);
    if (!inter) throw new Error('interaction not found');
    if (inter.status === 'ended') return { ok: true, alreadyEnded: true };
    await ctx.db.patch(args.interactionId, {
      status: 'ended' as const,
      endedAt: Date.now(),
      inflightSince: undefined,
      winner: 'cancelled',
    });

    // Dungeon-origin games: restore the teleported players + clean up
    // return-state rows. Without this, a cancelled stuck game would
    // leave agents at (-9999, -9999) forever.
    if (inter.originType === 'dungeon' && inter.worldId) {
      const returnRows = await ctx.db
        .query('dungeonReturnState')
        .withIndex('by_interaction', (q) =>
          q.eq('interactionId', args.interactionId),
        )
        .collect();
      const world = await ctx.db.get(inter.worldId);
      if (world && returnRows.length > 0) {
        const players = world.players.map((p) => ({ ...p }));
        for (const ret of returnRows) {
          const idx = players.findIndex((p) => p.id === ret.playerId);
          if (idx !== -1) {
            players[idx] = {
              ...players[idx]!,
              position: { x: ret.savedPosition.x, y: ret.savedPosition.y },
              facing: { dx: ret.savedFacing.dx, dy: ret.savedFacing.dy },
              pathfinding: undefined,
              activity: undefined,
              speed: 0,
            };
          }
          await ctx.db.delete(ret._id);
        }
        await ctx.db.patch(inter.worldId, { players });
      }
    }
    return { ok: true, reason: args.reason };
  },
});
