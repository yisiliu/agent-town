import { v } from 'convex/values';
import { query, internalMutation } from './_generated/server';

// Stub for ai-town's music.ts — replaces the full upstream version
// which imports the `replicate` npm package for AI-generated ambient
// music. The MusicButton in the frontend only consumes
// getBackgroundMusic, so the stub mirrors that one query (returning
// the default static track when no music rows exist) and leaves the
// Replicate-needing generators out.
//
// If/when we want AI-generated music, sync ai-town-fork/convex/music.ts
// over this file (`cp ai-town-fork/convex/music.ts convex/music.ts`)
// and `bun add replicate` + set REPLICATE_API_TOKEN.

export const insertMusic = internalMutation({
  args: {
    storageId: v.string(),
    type: v.union(v.literal('background'), v.literal('player')),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('music', {
      storageId: args.storageId,
      type: args.type,
    });
  },
});

export const getBackgroundMusic = query({
  handler: async (ctx) => {
    const music = await ctx.db
      .query('music')
      .filter((entry) => entry.eq(entry.field('type'), 'background'))
      .order('desc')
      .first();
    if (!music) {
      return '/ai-town/assets/background.mp3';
    }
    const url = await ctx.storage.getUrl(music.storageId);
    if (!url) {
      throw new Error(`Invalid storage ID: ${music.storageId}`);
    }
    return url;
  },
});
