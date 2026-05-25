import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../schema';
import { internal } from '../_generated/api';

const modules = import.meta.glob('../**/*.ts');

// Seed a default world that is either inert (no conversations + no agent
// moving) or active (one agent has pathfinding), plus engine + worldStatus +
// an engineWatchdog baseline (lastSeenGen = gen-1 so the first check lands in
// the gen-advancing branch).
async function seed(t: ReturnType<typeof convexTest>, opts: { inert: boolean; gen: number }) {
  return await t.run(async (ctx) => {
    const players = [0, 1, 2].map((i) => ({
      id: `p:${i}`,
      lastInput: 0,
      position: { x: i, y: 0 },
      facing: { dx: 1, dy: 0 },
      speed: 0,
      // active town → first agent is moving (has pathfinding)
      ...(!opts.inert && i === 0 ? { pathfinding: { destination: { x: 5, y: 5 }, started: 0, state: { kind: 'needsPath' as const } } } : {}),
    }));
    const worldId = await ctx.db.insert('worlds', {
      nextId: 6,
      conversations: [],
      players,
      agents: [0, 1, 2].map((i) => ({ id: `a:${i}`, playerId: `p:${i}` })),
    });
    const engineId = await ctx.db.insert('engines', { running: true, generationNumber: opts.gen });
    await ctx.db.insert('worldStatus', { worldId, engineId, isDefault: true, lastViewed: Date.now(), status: 'running' as const });
    await ctx.db.insert('engineWatchdog', { lastSeenGen: opts.gen - 1, lastSeenAt: Date.now(), unchangedCount: 0, wedgedCount: 0, reviveCount: 0 });
    return { worldId, engineId };
  });
}

describe('engineWatchdog — running-but-inert recovery', () => {
  it('inert town + gen advancing → wait once, then recover (stop+start) on 2nd check', async () => {
    const t = convexTest(schema, modules);
    const { engineId } = await seed(t, { inert: true, gen: 100 });

    const r1 = await t.mutation(internal.ours.crons.engineWatchdogMutation.default, {});
    expect((r1 as { action: string }).action).toBe('wedge-wait-for-confirmation');

    await t.run((ctx) => ctx.db.patch(engineId, { generationNumber: 101 }));
    const r2 = await t.mutation(internal.ours.crons.engineWatchdogMutation.default, {});
    expect((r2 as { action: string }).action).toBe('unwedged');

    // startEngine bumped gen + set running true (stop+start signature).
    const eng = await t.run((ctx) => ctx.db.get(engineId));
    expect(eng!.running).toBe(true);
    expect(eng!.generationNumber).toBeGreaterThan(101);
    const wd = await t.run((ctx) => ctx.db.query('engineWatchdog').first());
    expect(wd!.reviveCount).toBe(1);
    expect(wd!.wedgedCount).toBe(0);
  });

  it('active town (an agent moving) + gen advancing → healthy, no recovery', async () => {
    const t = convexTest(schema, modules);
    await seed(t, { inert: false, gen: 200 });
    const r = await t.mutation(internal.ours.crons.engineWatchdogMutation.default, {});
    expect((r as { action: string }).action).toBe('healthy');
    const wd = await t.run((ctx) => ctx.db.query('engineWatchdog').first());
    expect(wd!.reviveCount).toBe(0);
    expect(wd!.wedgedCount ?? 0).toBe(0);
  });
});
