import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../schema';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';

const modules = import.meta.glob('../**/*.ts');

// Seed a default world whose agents are either all-wedged (each holds an
// inProgressOperation) or healthy (at least one free), plus engine +
// worldStatus + an engineWatchdog baseline. Returns the ids.
async function seed(t: ReturnType<typeof convexTest>, opts: { allWedged: boolean; gen: number }) {
  return await t.run(async (ctx) => {
    const op = { name: 'agentDoSomething', operationId: 'op:1', started: 1 };
    const agents = [0, 1, 2].map((i) => ({
      id: `a:${i}`,
      playerId: `p:${i}`,
      // all-wedged → every agent stuck; healthy → first agent free
      ...(opts.allWedged || i > 0 ? { inProgressOperation: op } : {}),
    }));
    const worldId = await ctx.db.insert('worlds', {
      nextId: 6,
      conversations: [],
      players: [0, 1, 2].map((i) => ({ id: `p:${i}`, lastInput: 0, position: { x: i, y: 0 }, facing: { dx: 1, dy: 0 }, speed: 0 })),
      agents,
    });
    const engineId = await ctx.db.insert('engines', { running: true, generationNumber: opts.gen });
    await ctx.db.insert('worldStatus', { worldId, engineId, isDefault: true, lastViewed: Date.now(), status: 'running' as const });
    await ctx.db.insert('engineWatchdog', { lastSeenGen: opts.gen - 1, lastSeenAt: Date.now(), unchangedCount: 0, wedgedCount: 0, reviveCount: 0 });
    return { worldId, engineId };
  });
}

describe('engineWatchdog — wedged-but-running recovery', () => {
  it('all agents wedged + gen advancing → wait once, then un-wedge (stop+start) on 2nd check', async () => {
    const t = convexTest(schema, modules);
    const { engineId } = await seed(t, { allWedged: true, gen: 100 });

    // 1st check: detects the wedge, waits for confirmation.
    const r1 = await t.mutation(internal.ours.crons.engineWatchdogMutation.default, {});
    expect((r1 as { action: string }).action).toBe('wedge-wait-for-confirmation');

    // Engine still ticking (bump gen) but still wedged → 2nd check recovers.
    await t.run((ctx) => ctx.db.patch(engineId, { generationNumber: 101 }));
    const r2 = await t.mutation(internal.ours.crons.engineWatchdogMutation.default, {});
    expect((r2 as { action: string }).action).toBe('unwedged');

    // The recovery did a stop+start: startEngine bumps gen + sets running true.
    const eng = await t.run((ctx) => ctx.db.get(engineId));
    expect(eng!.running).toBe(true);
    expect(eng!.generationNumber).toBeGreaterThan(101); // startEngine bumped it
    const wd = await t.run((ctx) => ctx.db.query('engineWatchdog').first());
    expect(wd!.reviveCount).toBe(1);
    expect(wd!.wedgedCount).toBe(0);
  });

  it('healthy town (some agent free) + gen advancing → healthy, no recovery', async () => {
    const t = convexTest(schema, modules);
    await seed(t, { allWedged: false, gen: 200 });
    const r = await t.mutation(internal.ours.crons.engineWatchdogMutation.default, {});
    expect((r as { action: string }).action).toBe('healthy');
    const wd = await t.run((ctx) => ctx.db.query('engineWatchdog').first());
    expect(wd!.reviveCount).toBe(0);
    expect(wd!.wedgedCount ?? 0).toBe(0);
  });
});
