import { v } from 'convex/values';
import { query } from '../../_generated/server';

// Returns the full card.markdown so the instructor can eyeball the
// content. Use sparingly — markdown can be large.
export default query({
  args: { pseudonym: v.string() },
  handler: async (ctx, { pseudonym }) => {
    const twins = await ctx.db
      .query('twins')
      .withIndex('pseudonym', (q) => q.eq('pseudonym', pseudonym))
      .filter((q) => q.eq(q.field('state'), 'active'))
      .collect();
    const out: { pseudonym: string; createdAt: number; intro: string | null; markdown: string }[] = [];
    for (const t of twins) {
      if (!t.cardId) continue;
      const c = await ctx.db.get(t.cardId);
      if (!c) continue;
      out.push({
        pseudonym: t.pseudonym,
        createdAt: t.createdAt,
        intro: c.intro ?? null,
        markdown: c.markdown,
      });
    }
    return out;
  },
});
