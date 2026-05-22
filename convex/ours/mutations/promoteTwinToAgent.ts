import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { insertInput } from '../../aiTown/insertInput';
import { parseIntro } from '../lib/parseCard';

// Promotes a student-uploaded twin into an active ai-town agent.
// Reads the twin's card.markdown and uses it directly as the agent's
// identity field (the ai-town `agentDescriptions.identity` is the
// system-prompt persona for all conversation_reply calls). The plan
// field gets a generic default — students can describe behavioral plans
// in their card, but ai-town's `plan` is a one-sentence behavioral goal
// not the persona itself.
//
// Same-pseudonym replacement: when a student re-uploads, we want the
// newest card to take the in-world slot. Before queuing the join, we:
//   1. Suspend any OTHER active twin sharing this pseudonym (older
//      uploads become inert; dedup is no longer load-bearing).
//   2. Issue 'leave' inputs for every live player currently using
//      this name. Engine processes leaves before the subsequent join
//      (FIFO input queue) so the player slot is empty when we land.
//
// Returns the engine inputId for the createAgentInline — the engine
// processes it on the next tick and instantiates the agent + player +
// descriptions.

// Only f1-f8 exist in characters.ts. p1-p3 used to be here too, but
// hashing a twin to p1/p2/p3 made Player.join throw `Invalid character`
// — the createAgentInline input was processed and discarded, the player
// never joined, and ~27% of uploaded twins silently failed to enter the
// world. Keep this in sync with the `characters` list (data/characters.ts).
const SPRITE_SLOTS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'];

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

    // 1. Suspend older active twins sharing this pseudonym so the
    //    newest twin row owns the in-world slot going forward. Skip
    //    self — we just verified args.twinId is active.
    const sameNameActive = await ctx.db
      .query('twins')
      .withIndex('pseudonym', (q) => q.eq('pseudonym', twin.pseudonym))
      .filter((q) => q.eq(q.field('state'), 'active'))
      .collect();
    let suspendedOlder = 0;
    for (const other of sameNameActive) {
      if (other._id === args.twinId) continue;
      await ctx.db.patch(other._id, { state: 'suspended' });
      suspendedOlder++;
    }

    // 2. Leave any live players currently using this name. Read
    //    `worlds.players` (in-memory truth) and intersect with
    //    playerDescriptions rows to map id→name. Stale description
    //    rows (left by previous leaves without cleanup) are filtered
    //    out by the live-id check.
    const world = await ctx.db.get(worldId);
    const liveIds = new Set<string>((world?.players ?? []).map((p) => p.id as unknown as string));
    const descs = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldId!))
      .filter((q) => q.eq(q.field('name'), twin.pseudonym))
      .collect();
    let leftPlayers = 0;
    for (const d of descs) {
      const pid = d.playerId as unknown as string;
      if (!liveIds.has(pid)) continue;
      await insertInput(ctx, worldId, 'leave', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        playerId: pid as any,
      });
      leftPlayers++;
    }

    const sprite = pickSprite(twin.pseudonym);
    const plan = args.plan ?? '你想认识小镇上的其他居民，并按你的本心生活。';
    // `intro` may be missing on cards uploaded before the field existed;
    // re-parse on demand and fall back to the first paragraph or — at
    // the very worst — the full markdown so the UI never shows blank.
    const intro =
      (card.intro && card.intro.length > 0 ? card.intro : parseIntro(card.markdown)) ||
      card.markdown;

    const inputId = await insertInput(ctx, worldId, 'createAgentInline', {
      name: twin.pseudonym,
      character: sprite,
      identity: card.markdown,
      plan,
      description: intro,
    });
    return {
      inputId,
      worldId,
      sprite,
      pseudonym: twin.pseudonym,
      intro,
      suspendedOlder,
      leftPlayers,
    };
  },
});
