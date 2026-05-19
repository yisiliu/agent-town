/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../schema';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';

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
