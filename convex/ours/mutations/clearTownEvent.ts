import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { clearTownEventForWorld } from '../lib/townEventCore';

// Clear the active town event: restore each agent's original identity
// (from the snapshot taken at setTownEvent time) and delete the
// townEventState row. Idempotent — no-op if no event is set.
export default mutation({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => clearTownEventForWorld(ctx, args.worldId),
});
