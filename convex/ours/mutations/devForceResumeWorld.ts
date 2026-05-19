import { mutation } from '../../_generated/server';
import { manualResume } from '../lib/worldState';

// DEV-ONLY: bypass the instructor WebAuthn gate on resumeWorld so the
// town can be flipped 'live' without standing up the full auth flow
// during development. Remove or restrict before production deploy.
//
// In production the path is: instructor registers via WebAuthn
// (Task 7), gets an instructorSession token, calls resumeWorld with
// it. That flow exists today; this mutation just skips the token
// check.
export default mutation({
  args: {},
  handler: async (ctx) => {
    await manualResume(ctx, { now: Date.now() });
    return { resumed: true };
  },
});
