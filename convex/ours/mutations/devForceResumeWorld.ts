import { mutation } from '../../_generated/server';
import { manualResume } from '../lib/worldState';
import { stopEngine, startEngine } from '../../aiTown/main';

// DEV-ONLY: bypass the instructor WebAuthn gate on resumeWorld so the
// town can be flipped 'live' without standing up the full auth flow
// during development.
//
// On resume we force-jump the engine clock to wall-clock now (stop +
// start cycle — startEngine sets currentTime = Date.now()). Without
// this jump, any inputs queued while the world was frozen sit
// unprocessed: in frozen mode the engine falls hours behind real
// time (maxTicksPerStep caps in-game advancement at ~9.6s/runStep),
// and new inputs' `received` timestamps look like the future to the
// engine — they don't get handled until the clock catches up.
export default mutation({
  args: {},
  handler: async (ctx) => {
    await manualResume(ctx, { now: Date.now() });
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (status) {
      const engine = await ctx.db.get(status.engineId);
      if (engine?.running) {
        await stopEngine(ctx, status.worldId);
      }
      await startEngine(ctx, status.worldId);
    }
    return { resumed: true };
  },
});
