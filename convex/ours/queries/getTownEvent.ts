import { v } from 'convex/values';
import { query } from '../../_generated/server';

// Public query — the instructor dashboard reads this to show the current
// town event banner.
export default query({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const evt = await ctx.db
      .query('townEventState')
      .withIndex('by_world', (q) => q.eq('worldId', args.worldId))
      .unique();
    if (!evt) return null;
    return {
      eventText: evt.eventText,
      festivalKind: evt.festivalKind,
      setAt: evt.setAt,
      expiresAt: evt.expiresAt,
      agentsAffected: Object.keys(evt.originalIdentities).length,
    };
  },
});
