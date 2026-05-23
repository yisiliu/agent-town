import { query } from '../../_generated/server';

// Diagnostic: sample card.intro field and the matching
// playerDescriptions.description field side by side, so we can tell
// whether "看不到 intro" is a card-side data gap or a UI-side
// rendering issue.
export default query({
  args: {},
  handler: async (ctx) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    const worldId = status?.worldId;

    const cards = await ctx.db.query('cards').collect();
    const twins = await ctx.db
      .query('twins')
      .withIndex('state', (q) => q.eq('state', 'active'))
      .collect();
    const cardById = new Map(cards.map((c) => [c._id as unknown as string, c]));

    const descs = worldId
      ? await ctx.db
          .query('playerDescriptions')
          .withIndex('worldId', (q) => q.eq('worldId', worldId))
          .collect()
      : [];
    const descByName = new Map(descs.map((d) => [d.name, d]));

    return twins.slice(0, 30).map((t) => {
      const c = t.cardId ? cardById.get(t.cardId as unknown as string) : undefined;
      const d = descByName.get(t.pseudonym);
      return {
        pseudonym: t.pseudonym,
        cardHasIntro: c ? !!(c.intro && c.intro.length > 0) : false,
        cardIntroLength: c?.intro?.length ?? 0,
        cardIntroPreview: c?.intro?.slice(0, 60) ?? null,
        cardMarkdownLength: c?.markdown?.length ?? 0,
        descriptionLength: d?.description?.length ?? 0,
        descriptionPreview: d?.description?.slice(0, 60) ?? null,
        descriptionEqualsMarkdown: c && d ? d.description === c.markdown : null,
      };
    });
  },
});
