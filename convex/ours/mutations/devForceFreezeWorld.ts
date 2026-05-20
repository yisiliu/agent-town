import { mutation } from '../../_generated/server';
import { manualFreeze } from '../lib/worldState';

// DEV-ONLY: bypass the instructor WebAuthn gate on freezeWorld so the
// town can be paused without standing up the full auth flow during
// development / class demos. Mirror of devForceResumeWorld.
//
// In production the path is: instructor registers via WebAuthn → gets
// a session token → calls freezeWorld with it. This mutation just
// skips the token check.
export default mutation({
  args: {},
  handler: async (ctx) => {
    await manualFreeze(ctx, { now: Date.now() });
    return { frozen: true };
  },
});
