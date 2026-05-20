import { v } from 'convex/values';
import { query } from '../../_generated/server';

// Returns the agents currently alive in an ai-town world, with their
// names (from playerDescriptions). Used by the instructor dashboard's
// dungeon launch picker — startDungeonGame takes ai-town playerIds,
// so the picker has to reflect what's actually in the world right now.
//
// Skips human players (those with the `human` field set), since they
// can't participate in LLM-driven dungeons.
export default query({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) return [];

    // Look up names by joining with playerDescriptions
    const descs = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();
    const nameByPlayerId = new Map<string, string>();
    for (const d of descs) nameByPlayerId.set(d.playerId, d.name);

    return world.players
      .filter((p) => !p.human) // skip human player(s)
      .map((p) => ({
        playerId: p.id,
        name: nameByPlayerId.get(p.id) ?? p.id,
        position: { x: Math.round(p.position.x), y: Math.round(p.position.y) },
        inDungeon: p.position.x === -9999, // teleported = in-dungeon
      }));
  },
});
