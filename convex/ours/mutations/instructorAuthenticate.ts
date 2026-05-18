import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import {
  beginInstructorAuthentication,
  completeInstructorAuthentication,
} from '../lib/instructorAuth';

// Two-step WebAuthn assertion. Shell calls `begin` for options, hands
// them to navigator.credentials.get(), posts the response back through
// `complete`; on success the mutation returns a 12h session token
// scoped role=instructor.

export const begin = mutation({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    return beginInstructorAuthentication(ctx, args, Date.now());
  },
});

export const complete = mutation({
  args: {
    username: v.string(),
    response: v.any(),
  },
  handler: async (ctx, args) => {
    return completeInstructorAuthentication(ctx, args, Date.now());
  },
});
