import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { clearUploadResult } from '../lib/uploadResultsStore';

// The upload UI calls this once the user has confirmed "I've saved
// these codes". Deletes the plaintext-codes row.
export default mutation({
  args: { uploadSessionToken: v.string() },
  handler: async (ctx, { uploadSessionToken }) => {
    const deleted = await clearUploadResult(ctx, uploadSessionToken);
    return { deleted };
  },
});
