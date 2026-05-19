import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';

// Inserts a batch of LLM-generated personas as (twins, cards) row pairs.
// Used by seedTwinsForGame. The seed_hash in studentRealNameHash is a
// non-cryptographic synthetic value — these twins don't correspond to
// real students; they exist purely for testing/games.
export default internalMutation({
  args: {
    personas: v.array(
      v.object({
        pseudonym: v.string(),
        markdown: v.string(),
        archetype: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const out: Array<{ twinId: string; pseudonym: string }> = [];
    for (const p of args.personas) {
      const twinId = await ctx.db.insert('twins', {
        pseudonym: p.pseudonym,
        studentRealNameHash: `synth-${p.archetype}-${now}-${Math.random().toString(36).slice(2, 8)}`,
        state: 'active',
        createdAt: now,
      });
      const cardId = await ctx.db.insert('cards', {
        twinId,
        markdown: p.markdown,
        snapshotAt: now,
        piiScanStatus: 'pass',
        promptInjectionScanStatus: 'pass',
      });
      await ctx.db.patch(twinId, { cardId });
      out.push({ twinId: twinId as unknown as string, pseudonym: p.pseudonym });
    }
    return out;
  },
});
