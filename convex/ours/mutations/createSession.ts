import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { createSession as createSessionImpl } from '../lib/session';

// Issues a 24h student session after the caller has already verified
// the auth code + cleared rate limits. Does not itself verify the
// code — keeping this mutation pure means the shell can compose the
// verify+session flow atomically when it adds the WebAuthn second
// factor later.
export default mutation({
  args: {
    twinId: v.id('twins'),
    scope: v.union(
      v.literal('spectate'),
      v.literal('control'),
      v.literal('edit'),
    ),
    ip: v.optional(v.string()),
  },
  handler: async (ctx, { twinId, scope, ip }) => {
    return createSessionImpl(ctx, twinId, scope, Date.now(), { ip });
  },
});
