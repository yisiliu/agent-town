import { query } from '../../_generated/server';

export default query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('twins')
      .withIndex('state', (q) => q.eq('state', 'active'))
      .collect();
    return rows.map((r) => ({
      pseudonym: r.pseudonym,
      hash: r.studentRealNameHash,
    }));
  },
});
