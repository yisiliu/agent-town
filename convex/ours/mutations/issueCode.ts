import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { issueCodeFor } from '../lib/authCodeStore';

// Issue (or reissue) a six-digit student code for one of the three
// access scopes. The plaintext is returned exactly once — the caller is
// responsible for displaying it through a save-and-confirm gate.
// Storage is hashed (bcrypt); verifyCode reads the hash and compares.
export default mutation({
  args: {
    twinId: v.id('twins'),
    scope: v.union(
      v.literal('spectate'),
      v.literal('control'),
      v.literal('edit'),
    ),
  },
  handler: async (ctx, { twinId, scope }) => {
    return issueCodeFor(ctx, twinId, scope);
  },
});
