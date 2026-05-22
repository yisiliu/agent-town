import { v } from 'convex/values';
import { action, internalMutation } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { parseIntro } from '../lib/parseCard';

// Backfill the `intro` field on every `cards` row that doesn't have one yet.
// Safe to re-run — only touches rows missing intro. Also (optionally)
// rewrites the `playerDescriptions.description` for any twin that's
// already a live agent so the UI sidebar stops showing the full card dump.
//
// Paginated for the same reason as wipeEmbeddings: cards' markdown can be
// big, so a single-mutation read of the whole table risks 16MB limits.

const CHUNK = 50;

export const backfillCardsChunk = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Take a chunk of cards missing `intro`. Convex filter is index-free
    // for missing optionals, so we paginate by _creationTime.
    const rows = await ctx.db.query('cards').take(500);
    let updated = 0;
    let cursor: number | null = null;
    for (const row of rows) {
      if (row.intro !== undefined && row.intro !== '') continue;
      const intro = parseIntro(row.markdown);
      await ctx.db.patch(row._id, { intro });
      updated++;
      if (updated >= CHUNK) {
        cursor = row._creationTime;
        break;
      }
    }
    return { scanned: rows.length, updated, cursor };
  },
});

export const updatePlayerDescriptionsChunk = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Find all twins with an agentId (already promoted). For each, look up
    // the card.intro and rewrite the live playerDescription if it still
    // contains the full markdown.
    const twins = await ctx.db.query('twins').take(500);
    let updated = 0;
    let skipped = 0;
    for (const twin of twins) {
      if (!twin.cardId) {
        skipped++;
        continue;
      }
      const card = await ctx.db.get(twin.cardId);
      if (!card) continue;
      const intro =
        (card.intro && card.intro.length > 0 ? card.intro : parseIntro(card.markdown)) ||
        card.markdown;
      // Match playerDescription by name (== twin.pseudonym) on the default world.
      const status = await ctx.db
        .query('worldStatus')
        .filter((q) => q.eq(q.field('isDefault'), true))
        .first();
      if (!status) {
        skipped++;
        continue;
      }
      const pd = await ctx.db
        .query('playerDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', status.worldId))
        .filter((q) => q.eq(q.field('name'), twin.pseudonym))
        .first();
      if (!pd) {
        skipped++;
        continue;
      }
      if (pd.description === intro) {
        skipped++;
        continue;
      }
      await ctx.db.patch(pd._id, { description: intro });
      updated++;
    }
    return { updated, skipped };
  },
});

export default action({
  args: {},
  handler: async (ctx) => {
    let totalUpdated = 0;
    // Loop the cards backfill until no more updates happen.
    for (let i = 0; i < 50; i++) {
      const res: { scanned: number; updated: number; cursor: number | null } =
        await ctx.runMutation(internal.ours.mutations.backfillCardIntros.backfillCardsChunk, {});
      totalUpdated += res.updated;
      if (res.updated < CHUNK) break;
    }
    const pdRes: { updated: number; skipped: number } = await ctx.runMutation(
      internal.ours.mutations.backfillCardIntros.updatePlayerDescriptionsChunk,
      {},
    );
    return { cardsBackfilled: totalUpdated, playerDescriptionsUpdated: pdRes.updated };
  },
});
