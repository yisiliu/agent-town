import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';

// Loads everything an action needs to build prompts for one turn:
// - the interaction row
// - participant twins (pseudonym + card markdown)
// - prior turns (visibility filter happens in the action since Convex
//   forbids .filter() in queries)
export default internalQuery({
  args: { interactionId: v.id('interactions') },
  handler: async (ctx, args) => {
    const inter = await ctx.db.get(args.interactionId);
    if (!inter) return null;

    const twinRows = [];
    for (const twinId of inter.participants) {
      const twin = await ctx.db.get(twinId);
      if (!twin) continue;
      let markdown = '';
      if (twin.cardId) {
        const card = await ctx.db.get(twin.cardId);
        if (card) markdown = card.markdown;
      }
      twinRows.push({
        twinId: twin._id as Id<'twins'>,
        pseudonym: twin.pseudonym,
        cardMarkdown: markdown,
      });
    }

    const turns = await ctx.db
      .query('interactionTurns')
      .withIndex('by_interaction_and_turnIndex', (q) =>
        q.eq('interactionId', args.interactionId),
      )
      .take(500);

    return { interaction: inter, twins: twinRows, turns };
  },
});
