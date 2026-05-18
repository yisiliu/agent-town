import { v } from 'convex/values';
import { query } from '../../_generated/server';
import { verifyCodeFor } from '../lib/authCodeStore';

// Hash-compare the plaintext against the stored authCodes row. Pure
// read; rate-limiting and lockout live in Task 5. Callers that need to
// gate access should pair this with the rateLimit mutation.
export default query({
  args: {
    twinId: v.id('twins'),
    scope: v.union(
      v.literal('spectate'),
      v.literal('control'),
      v.literal('edit'),
    ),
    plaintext: v.string(),
  },
  handler: async (ctx, { twinId, scope, plaintext }) => {
    return verifyCodeFor(ctx, twinId, scope, plaintext);
  },
});
