/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../schema';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { getPlugin } from '../ours/interactions/gameRegistry';
import '../ours/interactions/werewolf';
import type { WerewolfState } from '../ours/interactions/werewolf/state';

const modules = import.meta.glob('../**/*.ts');

async function seedFiveTwins(t: ReturnType<typeof convexTest>): Promise<Id<'twins'>[]> {
  return await t.run(async (ctx) => {
    const ids: Id<'twins'>[] = [];
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      const twinId = await ctx.db.insert('twins', {
        pseudonym: `Player${i}`,
        studentRealNameHash: `hash-${i}`,
        state: 'active',
        createdAt: now,
      });
      const cardId = await ctx.db.insert('cards', {
        twinId,
        markdown: `# Player ${i}\nI am player ${i}.`,
        snapshotAt: now,
        piiScanStatus: 'pass',
        promptInjectionScanStatus: 'pass',
      });
      await ctx.db.patch(twinId, { cardId });
      ids.push(twinId);
    }
    return ids;
  });
}

describe('startInteraction', () => {
  it('inserts an interaction row with plugin-initialized state', async () => {
    const t = convexTest(schema, modules);
    const participants = await seedFiveTwins(t);
    const id = await t.mutation(
      internal.ours.mutations.startInteraction.default,
      { type: 'werewolf', participants, seed: 42 },
    );
    expect(id).toBeDefined();
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row).not.toBeNull();
    expect(row!.type).toBe('werewolf');
    expect(row!.status).toBe('in_progress');
    expect(row!.phase).toBe('night-werewolf');
    expect(row!.participants).toHaveLength(5);
    expect(row!.turnIndex).toBe(0);
    expect(row!.seed).toBe(42);
    expect((row!.state as { alive: unknown[] }).alive).toHaveLength(5);
  });

  it('rejects unknown plugin type', async () => {
    const t = convexTest(schema, modules);
    const participants = await seedFiveTwins(t);
    await expect(
      t.mutation(internal.ours.mutations.startInteraction.default, {
        type: 'tic-tac-toe',
        participants,
      }),
    ).rejects.toThrow(/unknown interaction type/);
  });

  it('rejects under min players', async () => {
    const t = convexTest(schema, modules);
    const participants = (await seedFiveTwins(t)).slice(0, 3);
    await expect(
      t.mutation(internal.ours.mutations.startInteraction.default, {
        type: 'werewolf',
        participants,
      }),
    ).rejects.toThrow(/needs ≥4/);
  });
});

describe('appendInteractionTurn', () => {
  it('applies a turn and advances turnIndex', async () => {
    const t = convexTest(schema, modules);
    const participants = await seedFiveTwins(t);
    const id = await t.mutation(internal.ours.mutations.startInteraction.default, {
      type: 'werewolf',
      participants,
      seed: 42,
    });
    const inter = await t.run((ctx) => ctx.db.get(id));
    const state = inter!.state as { roles: Record<string, string>; alive: Id<'twins'>[] };
    const werewolf = Object.entries(state.roles).find(([, r]) => r === 'werewolf')![0] as unknown as Id<'twins'>;
    const target = state.alive.find((i) => i !== werewolf)!;

    const res = await t.mutation(internal.ours.mutations.appendInteractionTurn.default, {
      interactionId: id,
      expectedTurnIndex: 0,
      phase: 'night-werewolf',
      kind: 'kill',
      actorTwinId: werewolf,
      text: 'I take them.',
      data: { target },
      visibility: [werewolf],
    });
    expect(res.applied).toBe(true);
    expect(res.ended).toBe(false);

    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after!.turnIndex).toBe(1);
    expect(after!.phase).toBe('night-seer');
  });

  it('rejects stale_turnIndex on the second concurrent write', async () => {
    const t = convexTest(schema, modules);
    const participants = await seedFiveTwins(t);
    const id = await t.mutation(internal.ours.mutations.startInteraction.default, {
      type: 'werewolf',
      participants,
      seed: 42,
    });
    const inter = await t.run((ctx) => ctx.db.get(id));
    const state = inter!.state as { roles: Record<string, string>; alive: Id<'twins'>[] };
    const werewolf = Object.entries(state.roles).find(([, r]) => r === 'werewolf')![0] as unknown as Id<'twins'>;
    const target = state.alive.find((i) => i !== werewolf)!;

    const a = await t.mutation(internal.ours.mutations.appendInteractionTurn.default, {
      interactionId: id,
      expectedTurnIndex: 0,
      phase: 'night-werewolf',
      kind: 'kill',
      actorTwinId: werewolf,
      text: 'first',
      data: { target },
      visibility: [werewolf],
    });
    expect(a.applied).toBe(true);

    const b = await t.mutation(internal.ours.mutations.appendInteractionTurn.default, {
      interactionId: id,
      expectedTurnIndex: 0,  // stale
      phase: 'night-werewolf',
      kind: 'kill',
      actorTwinId: werewolf,
      text: 'second',
      data: { target },
      visibility: [werewolf],
    });
    expect(b.applied).toBe(false);
    expect((b as { reason: string }).reason).toBe('stale_turnIndex');
  });
});

describe('full werewolf game — plan-driven smoke test', () => {
  it('drives a 5-player game to ended, villagers win when they vote correctly', async () => {
    const t = convexTest(schema, modules);
    const participants = await seedFiveTwins(t);
    const interactionId = await t.mutation(
      internal.ours.mutations.startInteraction.default,
      { type: 'werewolf', participants, seed: 42 },
    );
    const plugin = getPlugin('werewolf')!;

    // Cap loop iterations defensively; a healthy 5p game ends well under 30 turns.
    let iter = 0;
    const MAX_ITER = 60;
    let last: { phase: string; kind: string; actor: string | null } | null = null;
    while (iter < MAX_ITER) {
      iter += 1;
      const inter = await t.run((ctx) => ctx.db.get(interactionId));
      if (!inter || inter.status === 'ended') break;
      const state = inter.state as WerewolfState;
      const plan = plugin.planNextTurn(state);
      if (!plan) break;

      let kind = plan.kind;
      let data: unknown = undefined;
      let text = '';
      const actor = plan.actorTwinId;
      if (actor === null) {
        // System turn — no LLM, framework supplies systemText.
        kind = plan.kind;
        text = plan.systemText ?? '(system)';
      } else {
        const role = state.roles[actor as unknown as string];
        const alive = state.alive;
        if (plan.kind === 'kill') {
          // Werewolf takes first non-werewolf.
          const target = alive.find((id) => state.roles[id as unknown as string] !== 'werewolf')!;
          data = { target };
          text = `Tonight I take ${target}.`;
        } else if (plan.kind === 'peek') {
          // Seer peeks the werewolf.
          const werewolf = alive.find((id) => state.roles[id as unknown as string] === 'werewolf')!;
          data = { target: werewolf };
          text = `I peek ${werewolf}.`;
        } else if (plan.kind === 'speak') {
          text = `I am ${role}; I am suspicious of the werewolf.`;
        } else if (plan.kind === 'vote') {
          const werewolf = alive.find((id) => state.roles[id as unknown as string] === 'werewolf')!;
          // Villagers + seer vote werewolf; werewolf votes the first non-werewolf villager.
          const target = role === 'werewolf'
            ? alive.find((id) => id !== actor)!
            : werewolf;
          data = { target };
          text = `I vote ${target}.`;
        }
      }

      const res = await t.mutation(
        internal.ours.mutations.appendInteractionTurn.default,
        {
          interactionId,
          expectedTurnIndex: inter.turnIndex,
          phase: plan.phase,
          kind,
          actorTwinId: actor ?? undefined,
          text,
          data,
          visibility: plan.visibility,
        },
      );
      expect(res.applied).toBe(true);
      last = { phase: plan.phase, kind: plan.kind, actor: actor as unknown as string | null };
    }

    const final = await t.run((ctx) => ctx.db.get(interactionId));
    expect(final).not.toBeNull();
    expect(final!.status).toBe('ended');
    expect(final!.winner).toBe('villagers');
    expect(iter).toBeLessThan(MAX_ITER); // defensively bounded
    expect(last).not.toBeNull();
  });

  it('private night-kill turn is filtered out of a non-werewolf actor\'s visible view', async () => {
    const t = convexTest(schema, modules);
    const participants = await seedFiveTwins(t);
    const interactionId = await t.mutation(
      internal.ours.mutations.startInteraction.default,
      { type: 'werewolf', participants, seed: 42 },
    );

    // Drive one kill turn so a private turn exists.
    const inter = await t.run((ctx) => ctx.db.get(interactionId));
    const state = inter!.state as WerewolfState;
    const werewolf = Object.entries(state.roles).find(([, r]) => r === 'werewolf')![0] as unknown as Id<'twins'>;
    const target = state.alive.find((id) => id !== werewolf)!;
    await t.mutation(internal.ours.mutations.appendInteractionTurn.default, {
      interactionId,
      expectedTurnIndex: 0,
      phase: 'night-werewolf',
      kind: 'kill',
      actorTwinId: werewolf,
      text: 'kill',
      data: { target },
      visibility: [werewolf],
    });

    // Read all turns; assert the kill turn's visibility excludes a villager.
    const turns = await t.run((ctx) =>
      ctx.db
        .query('interactionTurns')
        .withIndex('by_interaction_and_turnIndex', (q) => q.eq('interactionId', interactionId))
        .collect(),
    );
    const killTurn = turns.find((tr) => tr.kind === 'kill')!;
    expect(killTurn.visibility).not.toBe('public');
    expect(killTurn.visibility).toEqual([werewolf]);

    const aVillager = state.alive.find((id) => state.roles[id as unknown as string] === 'villager')!;
    const visibility = killTurn.visibility as Id<'twins'>[];
    const visibleToVillager = visibility.includes(aVillager);
    expect(visibleToVillager).toBe(false);
  });

  it('ended interaction is excluded from listActiveInteractions', async () => {
    const t = convexTest(schema, modules);
    const participants = await seedFiveTwins(t);
    const interactionId = await t.mutation(
      internal.ours.mutations.startInteraction.default,
      { type: 'werewolf', participants, seed: 7 },
    );
    // Force-end by patching status directly (avoids re-driving the whole loop).
    await t.run(async (ctx) => {
      await ctx.db.patch(interactionId, { status: 'ended', endedAt: Date.now(), winner: 'villagers' });
    });
    const active = await t.query(internal.ours.queries.listActiveInteractions.default, {});
    expect(active.find((r) => r._id === interactionId)).toBeUndefined();
  });
});
