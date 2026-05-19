import { internalQuery } from '../../_generated/server';

// Internal — returns the ai-town worldStatus row marked
// isDefault: true (created by init.ts). Used by seed actions to know
// which world to enqueue inputs against.
export default internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .unique();
    if (!row) return null;
    return { worldId: row.worldId, engineId: row.engineId, status: row.status };
  },
});
