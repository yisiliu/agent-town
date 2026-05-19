import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';

// Dev helper: force an interaction to status='ended'. Used to stop a runaway
// or stuck game during live testing. Not part of the v1 production surface;
// the eventual instructor UI will replace this.
export default internalMutation({
  args: {
    interactionId: v.id('interactions'),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const inter = await ctx.db.get(args.interactionId);
    if (!inter) throw new Error('interaction not found');
    if (inter.status === 'ended') return { ok: true, alreadyEnded: true };
    await ctx.db.patch(args.interactionId, {
      status: 'ended' as const,
      endedAt: Date.now(),
      inflightSince: undefined,
      winner: 'cancelled',
    });
    return { ok: true, reason: args.reason };
  },
});
