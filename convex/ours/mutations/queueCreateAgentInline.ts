import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { insertInput } from '../../aiTown/insertInput';
import type { Id } from '../../_generated/dataModel';

// Internal — enqueues a createAgentInline input on the default world.
// The engine processes it on the next tick (~1s) and instantiates
// the agent + player + descriptions.
export default internalMutation({
  args: {
    worldId: v.id('worlds'),
    name: v.string(),
    character: v.string(),
    identity: v.string(),
    plan: v.string(),
  },
  handler: async (ctx, args) => {
    return await insertInput(ctx, args.worldId as Id<'worlds'>, 'createAgentInline', {
      name: args.name,
      character: args.character,
      identity: args.identity,
      plan: args.plan,
    });
  },
});
