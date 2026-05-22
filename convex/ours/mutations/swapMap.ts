import { mutation } from '../../_generated/server';
import * as map from '../../../data/gentle';

// Hot-swap the current world's `maps` row with whatever data/gentle.js
// currently exports. The frontend reads from this row (via `game.worldMap`)
// not from the static import, so an in-place update is the cleanest way
// to see a map change without re-initialising the world (which would
// nuke agents, chat history, embeddings).
//
// Side effects to expect:
//   - Agents standing on tiles that are now walls will pathfind weirdly
//     until they wander off.
//   - If the new map's dimensions exceed the old, existing players keep
//     their coordinates (no out-of-bounds because pokeworld is 45×35,
//     extending the old 45×32). If you swap to a smaller map, players
//     beyond the new bounds will visually clip outside.

export default mutation({
  args: {},
  handler: async (ctx) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('swapMap: no default world');

    const mapRow = await ctx.db
      .query('maps')
      .withIndex('worldId', (q) => q.eq('worldId', status.worldId))
      .first();
    if (!mapRow) throw new Error('swapMap: no maps row for default world');

    await ctx.db.patch(mapRow._id, {
      width: map.mapwidth,
      height: map.mapheight,
      tileSetUrl: map.tilesetpath,
      tileSetDimX: map.tilesetpxw,
      tileSetDimY: map.tilesetpxh,
      tileDim: map.tiledim,
      bgTiles: map.bgtiles,
      objectTiles: map.objmap,
      animatedSprites: map.animatedsprites,
    });

    return {
      ok: true,
      tileSetUrl: map.tilesetpath,
      dims: `${map.mapwidth}x${map.mapheight} @ ${map.tiledim}px`,
    };
  },
});
