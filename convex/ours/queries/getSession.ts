import { v } from 'convex/values';
import { query } from '../../_generated/server';
import { getSession as getSessionImpl } from '../lib/session';

// Returns {twinId, scope, expiresAt} for a live session, or null if
// the token is unknown / expired. Consumers must enforce scope
// themselves — this query exposes the scope, it does not narrow it.
export default query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    return getSessionImpl(ctx, token, Date.now());
  },
});
