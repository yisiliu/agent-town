import { internalMutation } from '../../_generated/server';
import { listExpiredTownEventIds } from '../lib/festivals';
import { clearTownEventForWorld } from '../lib/townEventCore';

// Clears town events whose expiresAt has passed. Runs every minute so
// festivals auto-end within ~1 minute of their 24-game-hour window.
export default internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const allEvents = await ctx.db.query('townEventState').collect();
    const expired = allEvents.filter(
      (evt) => evt.expiresAt !== undefined && evt.expiresAt <= now,
    );

    let cleared = 0;
    for (const evt of expired) {
      await clearTownEventForWorld(ctx, evt.worldId);
      cleared += 1;
    }

    return {
      checked: allEvents.length,
      expiredIds: listExpiredTownEventIds(allEvents, now),
      cleared,
    };
  },
});
