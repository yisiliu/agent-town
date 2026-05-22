import { v } from 'convex/values';
import { action, internalMutation } from '../../_generated/server';
import { internal } from '../../_generated/api';

// Clears the two embedding tables — embeddingsCache (text-hash → vec)
// and memoryEmbeddings (per-memory vec, vector-indexed). Run this
// before flipping EMBEDDING_DIMENSION (Together 1024 → MiniMax 1536);
// Convex's vector index won't migrate a dimension change while rows
// exist at the old dim.
//
// Side effect: agents lose memory similarity hits until they
// accumulate new memories. The memories table itself is untouched —
// just the embeddings — so memory text/importance survives, only the
// vector lookup goes dark.
//
// Paginated: 1024-dim float64 vectors are ~8KB each, so the full table
// blows past Convex's 16MB-per-function read limit. We delete in
// chunks of 200 and drive the loop from an action.

const CHUNK = 200;

export const wipeChunk = internalMutation({
  args: { table: v.union(v.literal('embeddingsCache'), v.literal('memoryEmbeddings')) },
  handler: async (ctx, { table }) => {
    const rows = await ctx.db.query(table).take(CHUNK);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return rows.length;
  },
});

export default action({
  args: {},
  handler: async (ctx) => {
    let cacheDeleted = 0;
    while (true) {
      const n: number = await ctx.runMutation(internal.ours.mutations.wipeEmbeddings.wipeChunk, {
        table: 'embeddingsCache',
      });
      cacheDeleted += n;
      if (n < CHUNK) break;
    }
    let memoryDeleted = 0;
    while (true) {
      const n: number = await ctx.runMutation(internal.ours.mutations.wipeEmbeddings.wipeChunk, {
        table: 'memoryEmbeddings',
      });
      memoryDeleted += n;
      if (n < CHUNK) break;
    }
    return { cacheDeleted, memoryDeleted };
  },
});
