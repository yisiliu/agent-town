import { v } from 'convex/values';
import { query } from '../../_generated/server';

export default query({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await ctx.db
      .query('twins')
      .withIndex('state', (q) => q.eq('state', state as any))
      .collect();
    return rows.map((r) => ({
      _id: r._id,
      pseudonym: r.pseudonym,
      createdAt: r.createdAt,
      isNpc: r.studentRealNameHash.startsWith('synth-'),
    }));
  },
});
