import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../schema';
import { internal } from '../_generated/api';

const modules = import.meta.glob('../**/*.ts');

// A schema-valid minimal active conversation between p:0 and p:1.
const liveConversation = {
  id: 'c:1',
  creator: 'p:0',
  created: 0,
  numMessages: 0,
  participants: [
    { playerId: 'p:0', invited: 0, status: { kind: 'participating' as const, started: 0 } },
    { playerId: 'p:1', invited: 0, status: { kind: 'participating' as const, started: 0 } },
  ],
};

// Seed a default world that is either inert (no conversations) or active (one
// live conversation), plus engine + worldStatus + an engineWatchdog baseline
// (lastSeenGen = gen-1 so the first check lands in the gen-advancing branch).
async function seed(t: ReturnType<typeof convexTest>, opts: { inert: boolean; gen: number }) {
  return await t.run(async (ctx) => {
    const worldId = await ctx.db.insert('worlds', {
      nextId: 6,
      conversations: opts.inert ? [] : [liveConversation],
      players: [0, 1, 2].map((i) => ({ id: `p:${i}`, lastInput: 0, position: { x: i, y: 0 }, facing: { dx: 1, dy: 0 }, speed: 0 })),
      agents: [0, 1, 2].map((i) => ({ id: `a:${i}`, playerId: `p:${i}` })),
    });
    const engineId = await ctx.db.insert('engines', { running: true, generationNumber: opts.gen });
    await ctx.db.insert('worldStatus', { worldId, engineId, isDefault: true, lastViewed: Date.now(), status: 'running' as const });
    await ctx.db.insert('engineWatchdog', { lastSeenGen: opts.gen - 1, lastSeenAt: Date.now(), unchangedCount: 0, wedgedCount: 0, reviveCount: 0 });
    return { worldId, engineId };
  });
}

// Drive one watchdog check with the engine's gen advanced by 1 (engine alive).
async function tick(t: ReturnType<typeof convexTest>, engineId: any, gen: number) {
  await t.run((ctx) => ctx.db.patch(engineId, { generationNumber: gen }));
  return (await t.mutation(internal.ours.crons.engineWatchdogMutation.default, {})) as { action: string };
}

describe('engineWatchdog — running-but-inert recovery', () => {
  it('inert town (0 conversations) + gen advancing → recover (stop+start) after 3 checks', async () => {
    const t = convexTest(schema, modules);
    const { engineId } = await seed(t, { inert: true, gen: 100 });

    expect((await t.mutation(internal.ours.crons.engineWatchdogMutation.default, {})).action).toBe('inert-wait-for-confirmation');
    expect((await tick(t, engineId, 101)).action).toBe('inert-wait-for-confirmation');
    expect((await tick(t, engineId, 102)).action).toBe('unwedged');

    const eng = await t.run((ctx) => ctx.db.get(engineId));
    expect(eng!.running).toBe(true);
    expect(eng!.generationNumber).toBeGreaterThan(102); // startEngine bumped it
    const wd = await t.run((ctx) => ctx.db.query('engineWatchdog').first());
    expect(wd!.reviveCount).toBe(1);
    expect(wd!.wedgedCount).toBe(0);
  });

  it('active town (a live conversation) + gen advancing → healthy, no recovery', async () => {
    const t = convexTest(schema, modules);
    await seed(t, { inert: false, gen: 200 });
    const r = await t.mutation(internal.ours.crons.engineWatchdogMutation.default, {});
    expect((r as { action: string }).action).toBe('healthy');
    const wd = await t.run((ctx) => ctx.db.query('engineWatchdog').first());
    expect(wd!.reviveCount).toBe(0);
    expect(wd!.wedgedCount ?? 0).toBe(0);
  });
});
