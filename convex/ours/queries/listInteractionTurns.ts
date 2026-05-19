import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';

// Returns all turns for the interaction in turnIndex-ascending order.
// Bounded at 500 — werewolf's max turn count for 5p is ~80; caller in the
// takeTurn action filters by `visibility` in JS (Convex guideline: no
// .filter() in queries when an index exists).
export default internalQuery({
  args: { interactionId: v.id('interactions') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('interactionTurns')
      .withIndex('by_interaction_and_turnIndex', (q) =>
        q.eq('interactionId', args.interactionId),
      )
      .take(500);
  },
});
