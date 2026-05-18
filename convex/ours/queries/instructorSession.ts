import { v } from 'convex/values';
import { query } from '../../_generated/server';
import { getInstructorSession } from '../lib/instructorAuth';

// Returns {instructorId, role, expiresAt} for a live instructor session
// or null when unknown/expired. role is always "instructor" — the
// constant exists so callers reading the union with student sessions
// can branch on it.
export default query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    return getInstructorSession(ctx, token, Date.now());
  },
});
