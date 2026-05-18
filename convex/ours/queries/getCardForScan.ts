import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';

// Internal — runTwinScans calls this to fetch the card text for scanning.
export default internalQuery({
  args: { twinId: v.id('twins') },
  handler: async (ctx, { twinId }) => {
    const twin = await ctx.db.get(twinId);
    if (!twin || !twin.cardId) return null;
    const card = await ctx.db.get(twin.cardId);
    if (!card) return null;
    return { cardId: card._id, markdown: card.markdown };
  },
});
