import { v } from 'convex/values';
import { query } from '../../_generated/server';

export default query({
  args: { pseudonym: v.string() },
  handler: async (ctx, { pseudonym }) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return { error: 'no world' };
    const pd = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', status.worldId))
      .filter((q) => q.eq(q.field('name'), pseudonym))
      .first();
    if (!pd) return { error: 'no playerDescription' };
    // Walk world.agents to find the agentId for this playerId, then
    // load agentDescriptions by agentId.
    const world = await ctx.db.get(status.worldId);
    const agentEntry = (world?.agents ?? []).find(
      (a: { id: string; playerId: string }) => a.playerId === (pd.playerId as unknown as string),
    );
    if (!agentEntry) return { error: 'no matching agent', playerId: pd.playerId };
    const ad = await ctx.db
      .query('agentDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', status.worldId).eq('agentId', agentEntry.id as any))
      .first();
    return {
      identityLength: ad?.identity?.length ?? 0,
      identityFirst200: ad?.identity?.slice(0, 200) ?? null,
      identityHasRainEvent: !!ad?.identity?.startsWith('[当前小镇事件'),
    };
  },
});
