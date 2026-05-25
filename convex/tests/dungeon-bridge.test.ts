import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../schema';
import { internal, api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';

const modules = import.meta.glob('../**/*.ts');

// Insert a minimal ai-town world with N agents — just enough to satisfy
// findOrCreateTwinForAgent's lookups (playerDescriptions, agentDescriptions,
// worlds.agents) and insertInput's worldStatus/engine lookup. Returns the
// worldId + engineId + the synthetic playerIds.
async function seedAiTownWorld(
  t: ReturnType<typeof convexTest>,
  n: number,
  theme = 'Townsfolk',
): Promise<{ worldId: Id<'worlds'>; engineId: Id<'engines'>; playerIds: string[] }> {
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

    // Engine + worldStatus — insertInput looks these up by worldId and
    // throws if absent, so every test that enqueues an engine input needs them.
    const engineId = await ctx.db.insert('engines', {
      running: true,
      generationNumber: 0,
    });
    await ctx.db.insert('worldStatus', {
      worldId,
      engineId,
      isDefault: true,
      lastViewed: Date.now(),
      status: 'running' as const,
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
    return { worldId, engineId, playerIds };
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
    expect(inter!.status).toBe('gathering');
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
    // End the first game so the double-borrow guard doesn't block the re-run
    // (the guard only refuses overlaps with live gathering/in_progress games).
    await t.run((ctx) =>
      ctx.db.patch(a.interactionId, { status: 'ended' as const, endedAt: Date.now() }),
    );
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

  it('staging: marks players pending + leaves them in place until a gatherStep runs', async () => {
    const t = convexTest(schema, modules);
    const { worldId, engineId, playerIds } = await seedAiTownWorld(t, 5, 'Tele');

    // Snapshot pre-gather positions
    const before = await t.run(async (ctx) => {
      const world = await ctx.db.get(worldId);
      return world!.players.map((p) => ({ id: p.id, position: p.position }));
    });

    const result = await t.mutation(api.ours.mutations.startDungeonGame.default, {
      worldId,
      type: 'werewolf',
      playerIds,
      seed: 1,
    });

    // Immediately after startDungeonGame: players are NOT hidden, the game is
    // gathering with pendingPlayerIds === playerIds, and no return rows yet.
    const inter = await t.run((ctx) => ctx.db.get(result.interactionId));
    expect(inter!.status).toBe('gathering');
    expect(inter!.pendingPlayerIds).toEqual(playerIds);
    expect(inter!.gatheringStartedAt).toBeDefined();

    const afterStart = await t.run(async (ctx) => {
      const world = await ctx.db.get(worldId);
      return world!.players;
    });
    for (const pid of playerIds) {
      const player = afterStart.find((p) => p.id === pid)!;
      expect(player.position.x).not.toBe(-9999);
      expect(player.position.y).not.toBe(-9999);
    }
    const noReturnsYet = await t.run((ctx) =>
      ctx.db
        .query('dungeonReturnState')
        .withIndex('by_interaction', (q) => q.eq('interactionId', result.interactionId))
        .collect(),
    );
    expect(noReturnsYet).toHaveLength(0);

    // Run a gatherStep — now each player is pulled off-map (teleport input to
    // -9999) and a return-state row snapshots their original position.
    await t.mutation(internal.ours.mutations.gatherStep.default, {
      interactionId: result.interactionId,
    });

    const teleports = await teleportInputs(t, engineId);
    expect(teleports).toHaveLength(5);
    for (const tp of teleports) {
      expect(tp.args.position).toEqual({ x: -9999, y: -9999 });
    }

    const returns = await t.run((ctx) =>
      ctx.db
        .query('dungeonReturnState')
        .withIndex('by_interaction', (q) => q.eq('interactionId', result.interactionId))
        .collect(),
    );
    expect(returns).toHaveLength(5);
    for (const r of returns) {
      const originalPos = before.find((b) => b.id === r.playerId)!.position;
      expect(r.savedPosition.x).toBe(originalPos.x);
      expect(r.savedPosition.y).toBe(originalPos.y);
    }
  });

  it('double-borrow guard: a second game with an overlapping player throws', async () => {
    const t = convexTest(schema, modules);
    const { worldId, playerIds } = await seedAiTownWorld(t, 9, 'Borrow');

    // First game claims players 0..4.
    await t.mutation(api.ours.mutations.startDungeonGame.default, {
      worldId,
      type: 'werewolf',
      playerIds: playerIds.slice(0, 5),
      seed: 1,
    });

    // Second game overlapping on player 4 must be rejected.
    await expect(
      t.mutation(api.ours.mutations.startDungeonGame.default, {
        worldId,
        type: 'werewolf',
        playerIds: playerIds.slice(4, 9),
        seed: 2,
      }),
    ).rejects.toThrow(/already in another dungeon game/);

    // A fully disjoint second game (players 5..8) is fine.
    const ok = await t.mutation(api.ours.mutations.startDungeonGame.default, {
      worldId,
      type: 'werewolf',
      playerIds: playerIds.slice(5, 9),
      seed: 3,
    });
    expect(ok.interactionId).toBeDefined();
  });

  it('teleport: restores positions when the game ends', async () => {
    const t = convexTest(schema, modules);
    const { worldId, playerIds } = await seedAiTownWorld(t, 4, 'Restore');

    const before = await t.run(async (ctx) => {
      const world = await ctx.db.get(worldId);
      return world!.players.map((p) => ({ id: p.id, position: p.position }));
    });

    const result = await t.mutation(api.ours.mutations.startDungeonGame.default, {
      worldId,
      type: 'werewolf',
      playerIds,
      seed: 42,
    });

    // Run a gatherStep to pull everyone in (creating the dungeonReturnState
    // rows the end-restore path reads) and flip the game to in_progress.
    await t.mutation(internal.ours.mutations.gatherStep.default, {
      interactionId: result.interactionId,
    });

    // Drive the game directly to ended by force-marking a winner state
    // via the engine. Simplest: trigger an append that triggers win.
    // For this test we'll just directly patch interaction state to a
    // wolves-win configuration to short-circuit through appendInteractionTurn's
    // restore path. Send a wolf-kill-bid that wipes all gods.
    const inter = await t.run((ctx) => ctx.db.get(result.interactionId));
    const state = inter!.state as { roles: Record<string, string>; alive: any[] };
    const wolves = Object.entries(state.roles)
      .filter(([, r]) => r === 'werewolf')
      .map(([id]) => id);
    // Force-end by patching the interaction to a 屠民边 state: only wolves alive.
    await t.run((ctx) =>
      ctx.db.patch(result.interactionId, {
        state: { ...state, alive: wolves.map((w) => w as any) },
      }),
    );
    // Now append a no-op system turn from a wolf to trigger the end check.
    const wolfTwin = wolves[0] as any;
    await t.mutation(internal.ours.mutations.appendInteractionTurn.default, {
      interactionId: result.interactionId,
      expectedTurnIndex: inter!.turnIndex,
      phase: 'night-werewolf',
      kind: 'wolf-kill-bid',
      actorTwinId: wolfTwin,
      text: 'wolves done',
      data: { target: wolves[1] ?? wolves[0] },
      visibility: [wolfTwin],
    });

    // Game should now be ended; positions should be restored
    const final = await t.run((ctx) => ctx.db.get(result.interactionId));
    expect(final!.status).toBe('ended');

    const after = await t.run(async (ctx) => {
      const world = await ctx.db.get(worldId);
      return world!.players;
    });
    for (const pid of playerIds) {
      const player = after.find((p) => p.id === pid)!;
      const orig = before.find((b) => b.id === pid)!;
      expect(player.position.x).toBe(orig.position.x);
      expect(player.position.y).toBe(orig.position.y);
    }

    // Return-state rows should be cleaned up
    const returns = await t.run((ctx) =>
      ctx.db
        .query('dungeonReturnState')
        .withIndex('by_interaction', (q) => q.eq('interactionId', result.interactionId))
        .collect(),
    );
    expect(returns).toHaveLength(0);
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

// Insert a 'gathering' interaction directly (bypassing startDungeonGame, which
// later tasks rewire). participants are dummy twin ids; gatherStep doesn't read
// them. Returns the interactionId.
async function seedGatheringInteraction(
  t: ReturnType<typeof convexTest>,
  worldId: Id<'worlds'>,
  pendingPlayerIds: string[],
  gatheringStartedAt: number,
): Promise<Id<'interactions'>> {
  return await t.run(async (ctx) => {
    // Dummy twins to satisfy participants: v.array(v.id('twins')).
    const participants: Id<'twins'>[] = [];
    for (const pid of pendingPlayerIds) {
      const twinId = await ctx.db.insert('twins', {
        pseudonym: `twin-${pid}`,
        studentRealNameHash: `aitown:${worldId}:${pid}`,
        state: 'active' as const,
        createdAt: Date.now(),
      });
      participants.push(twinId);
    }
    return await ctx.db.insert('interactions', {
      type: 'werewolf',
      status: 'gathering' as const,
      participants,
      state: {},
      turnIndex: 0,
      phase: 'gathering',
      lastTickAt: 0,
      seed: 1,
      startedAt: gatheringStartedAt,
      originType: 'dungeon' as const,
      worldId,
      originPlayerIds: pendingPlayerIds,
      pendingPlayerIds,
      gatheringStartedAt,
    });
  });
}

function makeConversation(convId: string, playerIds: string[]) {
  return {
    id: convId,
    creator: playerIds[0]!,
    created: 0,
    numMessages: 0,
    participants: playerIds.map((pid) => ({
      playerId: pid,
      invited: 0,
      status: { kind: 'participating' as const, started: 0 },
    })),
  };
}

// Test DB is tiny — collect all engine inputs and filter/sort in JS (avoids
// the index-typing on the loosely-typed helper `t`).
async function namedInputs(
  t: ReturnType<typeof convexTest>,
  engineId: Id<'engines'>,
  name: string,
): Promise<{ number: number; name: string; args: any }[]> {
  const rows = await t.run((ctx) => ctx.db.query('inputs').collect());
  return rows
    .filter((r: any) => r.engineId === engineId && r.name === name)
    .sort((a: any, b: any) => a.number - b.number);
}

async function teleportInputs(t: ReturnType<typeof convexTest>, engineId: Id<'engines'>) {
  return namedInputs(t, engineId, 'teleportPlayer');
}

describe('dungeon bridge — gatherStep', () => {
  it('(a) all players free → pulls everyone: N teleports, N return rows, empty pending, in_progress', async () => {
    const t = convexTest(schema, modules);
    const { worldId, engineId, playerIds } = await seedAiTownWorld(t, 4, 'Gather');
    const interactionId = await seedGatheringInteraction(t, worldId, playerIds, Date.now());

    await t.mutation(internal.ours.mutations.gatherStep.default, { interactionId });

    const teleports = await teleportInputs(t, engineId);
    expect(teleports).toHaveLength(4);
    for (const tp of teleports) {
      expect(tp.args.position).toEqual({ x: -9999, y: -9999 });
    }

    const returns = await t.run((ctx) =>
      ctx.db
        .query('dungeonReturnState')
        .withIndex('by_interaction', (q) => q.eq('interactionId', interactionId))
        .collect(),
    );
    expect(returns).toHaveLength(4);
    // Return rows snapshot the original positions.
    for (const r of returns) {
      const i = playerIds.indexOf(r.playerId);
      expect(r.savedPosition).toEqual({ x: i, y: 0 });
    }

    const inter = await t.run((ctx) => ctx.db.get(interactionId));
    expect(inter!.pendingPlayerIds).toEqual([]);
    expect(inter!.status).toBe('in_progress');
    expect(inter!.inflightSince).toBeUndefined();
  });

  it('(b) a player mid-conversation (<30s) stays pending, no teleport for them', async () => {
    const t = convexTest(schema, modules);
    const { worldId, engineId, playerIds } = await seedAiTownWorld(t, 4, 'GatherB');
    // p:0 and p:1 are talking to each other.
    await t.run((ctx) =>
      ctx.db.patch(worldId, {
        conversations: [makeConversation('c:0', [playerIds[0]!, playerIds[1]!])] as any,
      }),
    );
    const interactionId = await seedGatheringInteraction(t, worldId, playerIds, Date.now());

    await t.mutation(internal.ours.mutations.gatherStep.default, { interactionId });

    const teleports = await teleportInputs(t, engineId);
    // p:2, p:3 pulled; p:0, p:1 waiting.
    expect(teleports).toHaveLength(2);

    const inter = await t.run((ctx) => ctx.db.get(interactionId));
    expect(inter!.pendingPlayerIds!.sort()).toEqual([playerIds[0]!, playerIds[1]!].sort());
    expect(inter!.status).toBe('gathering');

    const leaves = await namedInputs(t, engineId, 'leaveConversation');
    expect(leaves).toHaveLength(0);
  });

  it('(c) gatheringStartedAt ≥30s ago + still talking → leaveConversation then pull', async () => {
    const t = convexTest(schema, modules);
    const { worldId, engineId, playerIds } = await seedAiTownWorld(t, 4, 'GatherC');
    await t.run((ctx) =>
      ctx.db.patch(worldId, {
        conversations: [makeConversation('c:0', [playerIds[0]!, playerIds[1]!])] as any,
      }),
    );
    const longAgo = Date.now() - 31_000;
    const interactionId = await seedGatheringInteraction(t, worldId, playerIds, longAgo);

    await t.mutation(internal.ours.mutations.gatherStep.default, { interactionId });

    // Both talkers force-left their conversation, then everyone pulled.
    const leaves = await namedInputs(t, engineId, 'leaveConversation');
    expect(leaves).toHaveLength(2);
    for (const lv of leaves) {
      expect(lv.args.conversationId).toBe('c:0');
    }
    const teleports = await teleportInputs(t, engineId);
    expect(teleports).toHaveLength(4);

    // For each forced player, the leaveConversation input number is LOWER than
    // their teleport (so the engine applies the leave first).
    for (const pid of [playerIds[0]!, playerIds[1]!]) {
      const leave = leaves.find((l) => l.args.playerId === pid)!;
      const tp = teleports.find((tt) => tt.args.playerId === pid)!;
      expect(leave.number).toBeLessThan(tp.number);
    }

    const inter = await t.run((ctx) => ctx.db.get(interactionId));
    expect(inter!.pendingPlayerIds).toEqual([]);
    expect(inter!.status).toBe('in_progress');
  });

  it('(d) a pending player absent from world.players → cancelled, already-pulled restored', async () => {
    const t = convexTest(schema, modules);
    const { worldId, engineId, playerIds } = await seedAiTownWorld(t, 4, 'GatherD');
    // Add a ghost id that is not in world.players. Order matters: put the
    // free real players first so they get pulled before we hit the ghost.
    const pending = [...playerIds, 'ghost:99'];
    const interactionId = await seedGatheringInteraction(t, worldId, pending, Date.now());

    await t.mutation(internal.ours.mutations.gatherStep.default, { interactionId });

    const inter = await t.run((ctx) => ctx.db.get(interactionId));
    expect(inter!.status).toBe('ended');
    expect(inter!.winner).toBe('cancelled');
    expect(inter!.endedAt).toBeDefined();
    expect(inter!.inflightSince).toBeUndefined();

    // Return-state rows for the already-pulled players are deleted by restore.
    const returns = await t.run((ctx) =>
      ctx.db
        .query('dungeonReturnState')
        .withIndex('by_interaction', (q) => q.eq('interactionId', interactionId))
        .collect(),
    );
    expect(returns).toHaveLength(0);

    // Each already-pulled player got a pull teleport (-9999) AND a restore
    // teleport back to their saved position.
    const teleports = await teleportInputs(t, engineId);
    const restoreTeleports = teleports.filter(
      (tp) => tp.args.position.x !== -9999,
    );
    expect(restoreTeleports.length).toBeGreaterThan(0);
    for (const tp of restoreTeleports) {
      const i = playerIds.indexOf(tp.args.playerId);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(tp.args.position).toEqual({ x: i, y: 0 });
    }
  });
});
