import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import { insertInput } from '../../aiTown/insertInput';

// Teleport every dungeon-borrowed player of an interaction back to their saved
// spot via engine inputs, then delete the return-state rows. The engine applies
// the teleports on the next tick (never clobbered), so we don't touch
// world.players here. Used by gatherStep's cancel path; D7 reuses it for
// game-end + cancelInteraction.
export async function restoreDungeonPlayers(
  ctx: MutationCtx,
  interactionId: Id<'interactions'>,
  worldId: Id<'worlds'>,
): Promise<void> {
  const rows = await ctx.db
    .query('dungeonReturnState')
    .withIndex('by_interaction', (q) => q.eq('interactionId', interactionId))
    .collect();
  for (const row of rows) {
    await insertInput(ctx, worldId, 'teleportPlayer', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      playerId: row.playerId as any,
      position: { x: row.savedPosition.x, y: row.savedPosition.y },
      facing: { dx: row.savedFacing.dx, dy: row.savedFacing.dy },
    });
    await ctx.db.delete(row._id);
  }
}
