import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import {
  synthesizeCardForAgent,
  dungeonTwinHashKey,
} from '../lib/dungeonBridge';

// Find or create a twin row that represents an ai-town agent in the
// Interactions framework. Idempotent: same (worldId, playerId) always
// returns the same twinId (look-up keyed on the dungeon hash via the
// `studentRealNameHash` field — re-purposed; for dungeon twins this isn't
// a real student hash).
//
// Loads ai-town's playerDescriptions + agentDescriptions + worlds.agents
// to extract the agent's name + identity + plan, then synthesizes a
// Markdown card via dungeonBridge.synthesizeCardForAgent.
export default internalMutation({
  args: {
    worldId: v.id('worlds'),
    playerId: v.string(),
  },
  handler: async (ctx, args) => {
    const hashKey = dungeonTwinHashKey(args.worldId as unknown as string, args.playerId);

    // 1. Look up an existing twin by dungeon hash. Re-purposes the
    //    studentRealNameHash field as a synthetic key.
    const existing = await ctx.db
      .query('twins')
      .filter((q) => q.eq(q.field('studentRealNameHash'), hashKey))
      .first();
    if (existing) {
      return { twinId: existing._id as Id<'twins'>, created: false };
    }

    // 2. Look up the ai-town playerDescription for name/character.
    const playerDesc = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) =>
        q.eq('worldId', args.worldId).eq('playerId', args.playerId),
      )
      .unique();
    if (!playerDesc) {
      throw new Error(
        `findOrCreateTwinForAgent: no playerDescription for ${args.playerId} in world ${args.worldId}`,
      );
    }

    // 3. Find the agentId for this player by scanning world.agents.
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`findOrCreateTwinForAgent: world ${args.worldId} not found`);
    }
    const agent = (world.agents ?? []).find(
      (a) => a.playerId === args.playerId,
    );
    let identity = '';
    let plan = '';
    if (agent) {
      const agentDesc = await ctx.db
        .query('agentDescriptions')
        .withIndex('worldId', (q) =>
          q.eq('worldId', args.worldId).eq('agentId', agent.id),
        )
        .unique();
      if (agentDesc) {
        identity = agentDesc.identity;
        plan = agentDesc.plan;
      }
    }

    // 4. Synthesize a Markdown card.
    const markdown = synthesizeCardForAgent({
      name: playerDesc.name,
      description: playerDesc.description,
      character: playerDesc.character,
      identity,
      plan,
    });

    // 5. Insert twin + card.
    const now = Date.now();
    const twinId = await ctx.db.insert('twins', {
      pseudonym: playerDesc.name,
      studentRealNameHash: hashKey,
      state: 'active',
      createdAt: now,
    });
    const cardId = await ctx.db.insert('cards', {
      twinId,
      markdown,
      snapshotAt: now,
      piiScanStatus: 'pass',
      promptInjectionScanStatus: 'pass',
    });
    await ctx.db.patch(twinId, { cardId });
    return { twinId: twinId as Id<'twins'>, created: true };
  },
});
