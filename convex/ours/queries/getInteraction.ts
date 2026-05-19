import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';

export default internalQuery({
  args: { id: v.id('interactions') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
