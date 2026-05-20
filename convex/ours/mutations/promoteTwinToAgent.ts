import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { insertInput } from '../../aiTown/insertInput';

// Promotes a student-uploaded twin into an active ai-town agent.
// Reads the twin's card.markdown and uses it directly as the agent's
// identity field (the ai-town `agentDescriptions.identity` is the
// system-prompt persona for all conversation_reply calls). The plan
// field gets a generic default — students can describe behavioral plans
// in their card, but ai-town's `plan` is a one-sentence behavioral goal
// not the persona itself.
//
// Sprite slot: cycles through f1-f8 + p1-p3 deterministically by the
// hash of the twin's pseudonym, so re-promotion produces the same
// sprite. Future task: let students choose / preview.
//
// Returns the engine inputId — the engine processes it on the next
// tick (~1s) and instantiates the agent + player + descriptions.
const SPRITE_SLOTS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'p1', 'p2', 'p3'];

function pickSprite(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return SPRITE_SLOTS[Math.abs(h) % SPRITE_SLOTS.length]!;
}

export default mutation({
  args: {
    twinId: v.id('twins'),
    worldId: v.optional(v.id('worlds')),
    plan: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const twin = await ctx.db.get(args.twinId);
    if (!twin) throw new Error(`twin ${args.twinId} not found`);
    if (twin.state !== 'active') {
      throw new Error(
        `twin ${args.twinId} is not active (state: ${twin.state}); only active twins can join the town`,
      );
    }
    if (!twin.cardId) {
      throw new Error(`twin ${args.twinId} has no card.md`);
    }
    const card = await ctx.db.get(twin.cardId);
    if (!card) throw new Error(`card ${twin.cardId} not found`);

    // Resolve worldId: explicit arg wins; otherwise default world.
    let worldId: Id<'worlds'> | undefined = args.worldId;
    if (!worldId) {
      const status = await ctx.db
        .query('worldStatus')
        .filter((q) => q.eq(q.field('isDefault'), true))
        .unique();
      if (!status) {
        throw new Error(
          'promoteTwinToAgent: no default world. Pass worldId explicitly or run ai-town init first.',
        );
      }
      worldId = status.worldId;
    }

    const sprite = pickSprite(twin.pseudonym);
    const plan = args.plan ?? '你想认识小镇上的其他居民，并按你的本心生活。';

    const inputId = await insertInput(ctx, worldId, 'createAgentInline', {
      name: twin.pseudonym,
      character: sprite,
      identity: card.markdown,
      plan,
    });
    return { inputId, worldId, sprite, pseudonym: twin.pseudonym };
  },
});
