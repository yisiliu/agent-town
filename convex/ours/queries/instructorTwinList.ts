import { v } from 'convex/values';
import { query } from '../../_generated/server';

// Public query for the instructor dashboard. Lists all twins ordered
// by creation time (newest first), with an optional state filter and
// pagination via .take().
//
// v1 has no auth gate — assumes instructor is on localhost during the
// class. Production would add an instructorSession token check.
export default query({
  args: {
    limit: v.optional(v.number()),
    activeOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    const rows = await ctx.db
      .query('twins')
      .order('desc')
      .take(limit);
    const filtered = args.activeOnly
      ? rows.filter((r) => r.state === 'active')
      : rows;
    return filtered.map((r) => ({
      _id: r._id,
      pseudonym: r.pseudonym,
      state: r.state,
      hasCard: r.cardId !== undefined,
      createdAt: r.createdAt,
      // Only true synth-NPCs from seedNpcCards are tagged synthetic.
      // The `aitown:<worldId>:...` prefix marks twins that were
      // reconciled with an ai-town agent record during a re-promote
      // — those are real student-uploaded twins, not AI-synthesised
      // ones. Including aitown:* here mislabeled ~13 of 17 students.
      isSynthetic: r.studentRealNameHash.startsWith('synth-'),
    }));
  },
});
