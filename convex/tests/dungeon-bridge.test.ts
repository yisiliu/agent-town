import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../schema';
import { internal, api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';

const modules = import.meta.glob('../**/*.ts');

// Insert a minimal ai-town world with N agents — just enough to satisfy
// findOrCreateTwinForAgent's lookups (playerDescriptions, agentDescriptions,
// worlds.agents). Returns the worldId + the synthetic playerIds.
async function seedAiTownWorld(
  t: ReturnType<typeof convexTest>,
  n: number,
  theme = 'Townsfolk',
): Promise<{ worldId: Id<'worlds'>; playerIds: string[] }> {
  return await t.run(async (ctx) => {
    const playerIds = Array.from({ length: n }, (_, i) => `p:${i}`);
    const agentIds = Array.from({ length: n }, (_, i) => `a:${i}`);

    // Create the world doc with all required fields populated minimally.
    const worldId = await ctx.db.insert('worlds', {
      nextId: n * 2,
      conversations: [],
      players: playerIds.map((pid, i) => ({
        id: pid,
        lastInput: 0,
        position: { x: i, y: 0 },
        facing: { dx: 1, dy: 0 },
        speed: 0,
      })),
      agents: agentIds.map((aid, i) => ({
        id: aid,
        playerId: playerIds[i]!,
      })),
    });

    // playerDescriptions
    for (let i = 0; i < n; i++) {
      await ctx.db.insert('playerDescriptions', {
        worldId,
        playerId: playerIds[i]!,
        name: `${theme}_${i}`,
        description: `${theme} number ${i} — a generic resident.`,
        character: i % 2 === 0 ? 'f1' : 'p1',
      });
    }
    // agentDescriptions
    for (let i = 0; i < n; i++) {
      await ctx.db.insert('agentDescriptions', {
        worldId,
        agentId: agentIds[i]!,
        identity: `${theme}_${i} 是一位思考问题的居民，平时在街角观察来往的人。`,
        plan: `You want to make sense of who's who in this town.`,
      });
    }
    return { worldId, playerIds };
  });
}

describe('dungeon bridge — startDungeonGame', () => {
  it('creates twins for 9 ai-town agents and tags interaction as dungeon-origin', async () => {
    const t = convexTest(schema, modules);
    const { worldId, playerIds } = await seedAiTownWorld(t, 9, 'Resident');

    const result = await t.mutation(api.ours.mutations.startDungeonGame.default, {
      worldId,
      type: 'werewolf',
      playerIds,
      seed: 42,
    });

    expect(result.interactionId).toBeDefined();
    expect(result.participants).toHaveLength(9);

    const inter = await t.run((ctx) => ctx.db.get(result.interactionId));
    expect(inter).not.toBeNull();
    expect(inter!.type).toBe('werewolf');
    expect(inter!.originType).toBe('dungeon');
    expect(inter!.worldId).toBe(worldId);
    expect(inter!.originPlayerIds).toEqual(playerIds);
    expect(inter!.participants).toHaveLength(9);
    expect(inter!.status).toBe('in_progress');
  });

  it('is idempotent: re-running with the same (worldId, playerIds) reuses twins', async () => {
    const t = convexTest(schema, modules);
    const { worldId, playerIds } = await seedAiTownWorld(t, 5, 'IdempCheck');

    // First call
    const a = await t.mutation(api.ours.mutations.startDungeonGame.default, {
      worldId,
      type: 'werewolf',
      playerIds,
      seed: 1,
    });
    // Second call — should reuse the same twin IDs
    const b = await t.mutation(api.ours.mutations.startDungeonGame.default, {
      worldId,
      type: 'werewolf',
      playerIds,
      seed: 2,
    });

    expect(b.participants).toEqual(a.participants);
    // But two distinct interaction rows
    expect(b.interactionId).not.toBe(a.interactionId);
  });

  it('rejects below-min players', async () => {
    const t = convexTest(schema, modules);
    const { worldId, playerIds } = await seedAiTownWorld(t, 3, 'TooFew');
    await expect(
      t.mutation(api.ours.mutations.startDungeonGame.default, {
        worldId,
        type: 'werewolf',
        playerIds,
      }),
    ).rejects.toThrow(/needs ≥4/);
  });

  it('rejects unknown game type', async () => {
    const t = convexTest(schema, modules);
    const { worldId, playerIds } = await seedAiTownWorld(t, 9, 'BadGame');
    await expect(
      t.mutation(api.ours.mutations.startDungeonGame.default, {
        worldId,
        type: 'chess',
        playerIds,
      }),
    ).rejects.toThrow(/unknown dungeon type/);
  });

  it('the synthesized twin card includes the ai-town agent identity', async () => {
    const t = convexTest(schema, modules);
    const { worldId, playerIds } = await seedAiTownWorld(t, 4, 'CardCheck');

    await t.mutation(api.ours.mutations.startDungeonGame.default, {
      worldId,
      type: 'werewolf',
      playerIds,
      seed: 7,
    });

    // Look up the first agent's twin + card
    const twin = await t.run(async (ctx) => {
      return await ctx.db
        .query('twins')
        .filter((q) =>
          q.eq(q.field('studentRealNameHash'), `aitown:${worldId}:${playerIds[0]}`),
        )
        .unique();
    });
    expect(twin).not.toBeNull();
    expect(twin!.pseudonym).toBe('CardCheck_0');

    const card = await t.run((ctx) => ctx.db.get(twin!.cardId!));
    expect(card).not.toBeNull();
    expect(card!.markdown).toContain('CardCheck_0');
    expect(card!.markdown).toContain('一位思考问题的居民');
  });
});
