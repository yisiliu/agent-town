import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { insertInput } from '../../aiTown/insertInput';

// Rename a twin: patches twin.pseudonym, rewrites the `pseudonym:`
// line in card.markdown frontmatter, and leaves any in-world player
// whose name still matches the OLD pseudonym so the rename is
// reflected the next time the twin is promoted. Caller should then
// invoke promoteTwinToAgent to re-join with the new name.
export default mutation({
  args: {
    twinId: v.id('twins'),
    newPseudonym: v.string(),
  },
  handler: async (ctx, args) => {
    const twin = await ctx.db.get(args.twinId);
    if (!twin) return { error: 'twin not found' as const };
    const oldPseudonym = twin.pseudonym;
    if (oldPseudonym === args.newPseudonym) {
      return { error: 'old == new pseudonym' as const };
    }

    // 1. Leave the old in-world player(s) by old name.
    let leavesIssued = 0;
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (status) {
      const descs = await ctx.db
        .query('playerDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', status.worldId))
        .filter((q) => q.eq(q.field('name'), oldPseudonym))
        .collect();
      for (const d of descs) {
        try {
          await insertInput(ctx, status.worldId, 'leave', {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            playerId: d.playerId as any,
          });
          leavesIssued++;
        } catch { /* already gone */ }
      }
    }

    // 2. Patch twin.pseudonym.
    await ctx.db.patch(args.twinId, { pseudonym: args.newPseudonym });

    // 3. Patch card.markdown: rewrite the `pseudonym:` frontmatter
    // line (and any other occurrence of the old name in body text).
    let cardPatched = false;
    if (twin.cardId) {
      const card = await ctx.db.get(twin.cardId);
      if (card) {
        // Replace `pseudonym: <old>` in YAML frontmatter lines first
        // (the canonical reference), then any remaining occurrences.
        const updated = card.markdown
          .replace(
            /^pseudonym\s*:\s*.+$/gm,
            `pseudonym: ${args.newPseudonym}`,
          )
          .split(oldPseudonym)
          .join(args.newPseudonym);
        if (updated !== card.markdown) {
          await ctx.db.patch(card._id, { markdown: updated });
          cardPatched = true;
        }
      }
    }

    return {
      oldPseudonym,
      newPseudonym: args.newPseudonym,
      leavesIssued,
      cardPatched,
    };
  },
});
