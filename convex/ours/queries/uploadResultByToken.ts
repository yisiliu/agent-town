import { v } from 'convex/values';
import { query, internalQuery } from '../../_generated/server';
import { readUploadResult } from '../lib/uploadResultsStore';

// Public reactive — the upload UI polls this with the token returned
// from uploadTwin. Returns null until the scan completes (or the row
// expires).
export const byToken = query({
  args: { uploadSessionToken: v.string() },
  handler: async (ctx, { uploadSessionToken }) => {
    return readUploadResult(ctx, uploadSessionToken, Date.now());
  },
});

// Internal — runTwinScans uses this to look up the token for a given
// twin so finalizeScan can update the right row.
export const tokenForTwin = internalQuery({
  args: { twinId: v.id('twins') },
  handler: async (ctx, { twinId }) => {
    const row = await ctx.db
      .query('uploadResults')
      .withIndex('twinId', (q) => q.eq('twinId', twinId))
      .first();
    return row?.uploadSessionToken ?? null;
  },
});
