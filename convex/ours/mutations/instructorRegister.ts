import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import {
  beginInstructorRegistration,
  completeInstructorRegistration,
} from '../lib/instructorAuth';

// Two-step WebAuthn registration. The shell calls `begin` to get the
// PublicKeyCredentialCreationOptions, hands them to navigator.credentials
// .create() (via @simplewebauthn/browser), then calls `complete` with the
// attestation response. The server-side challenge bridges the two calls.

export const begin = mutation({
  args: {
    username: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, args) => {
    return beginInstructorRegistration(ctx, args, Date.now());
  },
});

export const complete = mutation({
  args: {
    username: v.string(),
    response: v.any(),
  },
  handler: async (ctx, args) => {
    return completeInstructorRegistration(ctx, args, Date.now());
  },
});
