import { v } from 'convex/values';
import { query } from '../../_generated/server';

export default query({
  args: { pseudonym: v.string() },
  handler: async (ctx, { pseudonym }) => {
    const twin = await ctx.db
      .query('twins')
      .withIndex('pseudonym', (q) => q.eq('pseudonym', pseudonym))
      .filter((q) => q.eq(q.field('state'), 'active'))
      .first();
    if (!twin?.cardId) return { error: 'no card' };
    const card = await ctx.db.get(twin.cardId);
    if (!card) return { error: 'card not found' };
    return {
      pseudonym,
      intro: card.intro,
      markdownLength: card.markdown.length,
      markdownFirst500: card.markdown.slice(0, 500),
    };
  },
});
