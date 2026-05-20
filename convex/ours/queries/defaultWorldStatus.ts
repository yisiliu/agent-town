import { query } from '../../_generated/server';

// Public — returns the ai-town worldStatus row marked isDefault: true
// (created by init.ts). Read-only metadata (worldId / engineId / status);
// safe to expose publicly. Used by:
//   - seedTownPlayers / seedTwinsForGame actions (via ctx.runQuery)
//   - the instructor dashboard (/instructor page; needs worldId to call
//     other mutations)
// Was internal in v1; promoted to public when the dashboard landed.
export default query({
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
