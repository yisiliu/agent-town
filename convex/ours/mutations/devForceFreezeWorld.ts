import { mutation } from '../../_generated/server';
import { manualFreeze } from '../lib/worldState';
import { kickEngine } from '../../aiTown/main';

// DEV-ONLY: bypass the instructor WebAuthn gate on freezeWorld so the
// town can be paused without standing up the full auth flow during
// development / class demos. Mirror of devForceResumeWorld.
//
// In production the path is: instructor registers via WebAuthn → gets
// a session token → calls freezeWorld with it. This mutation just
// skips the token check.
//
// Also kicks the engine so the new pace (frozen → 30s/tick) takes
// effect immediately — otherwise the current runStep keeps sleeping
// 2.5s until its action duration expires.
export default mutation({
  args: {},
  handler: async (ctx) => {
    await manualFreeze(ctx, { now: Date.now() });
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (status) await kickEngine(ctx, status.worldId);
    return { frozen: true };
  },
});
