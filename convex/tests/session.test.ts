import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../schema';
import {
  createSession,
  getSession,
  revokeSession,
  SESSION_TTL_MS,
} from '../ours/lib/session';

const modules = import.meta.glob('../**/*.ts');

function newTwin() {
  return {
    pseudonym: `rose-fox-${Math.floor(Math.random() * 1e6)}`,
    studentRealNameHash: 'sha256-fake',
    state: 'active' as const,
    createdAt: Date.now(),
  };
}

describe('lib/session', () => {
  it('createSession returns an opaque token of healthy entropy', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const twinId = await ctx.db.insert('twins', newTwin());
      const now = Date.now();
      const { token, expiresAt } = await createSession(
        ctx,
        twinId,
        'control',
        now,
      );
      expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(expiresAt).toBe(now + SESSION_TTL_MS);
    });
  });

  it('getSession returns {twinId, scope, expiresAt} for a live token', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const twinId = await ctx.db.insert('twins', newTwin());
      const now = Date.now();
      const { token } = await createSession(ctx, twinId, 'spectate', now);

      const got = await getSession(ctx, token, now + 1_000);
      expect(got).not.toBeNull();
      expect(got!.twinId).toBe(twinId);
      expect(got!.scope).toBe('spectate');
      expect(got!.expiresAt).toBe(now + SESSION_TTL_MS);
    });
  });

  it('getSession returns null for an unknown token', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const got = await getSession(ctx, 'definitely-not-a-real-token', Date.now());
      expect(got).toBeNull();
    });
  });

  it('getSession returns null past expiry', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const twinId = await ctx.db.insert('twins', newTwin());
      const t0 = 1_700_000_000_000;
      const { token } = await createSession(ctx, twinId, 'edit', t0);

      // Just inside the window: present.
      const alive = await getSession(ctx, token, t0 + SESSION_TTL_MS - 1);
      expect(alive).not.toBeNull();

      // At expiry / past expiry: gone.
      const expired = await getSession(ctx, token, t0 + SESSION_TTL_MS);
      expect(expired).toBeNull();
      const farPast = await getSession(ctx, token, t0 + SESSION_TTL_MS + 60_000);
      expect(farPast).toBeNull();
    });
  });

  it('separate calls produce distinct tokens', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const twinId = await ctx.db.insert('twins', newTwin());
      const a = await createSession(ctx, twinId, 'control', Date.now());
      const b = await createSession(ctx, twinId, 'control', Date.now());
      expect(a.token).not.toBe(b.token);
    });
  });

  it('scopes are independent — a spectate session cannot stand in for a control session', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const twinId = await ctx.db.insert('twins', newTwin());
      const { token: specToken } = await createSession(
        ctx,
        twinId,
        'spectate',
        Date.now(),
      );
      const got = await getSession(ctx, specToken, Date.now() + 100);
      // The session model exposes the scope; consumer code checks it.
      // We assert here that the model does not silently widen.
      expect(got!.scope).toBe('spectate');
      expect(got!.scope).not.toBe('control');
    });
  });

  it('revokeSession deletes the row (subsequent getSession returns null)', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const twinId = await ctx.db.insert('twins', newTwin());
      const now = Date.now();
      const { token } = await createSession(ctx, twinId, 'control', now);
      expect(await getSession(ctx, token, now + 1)).not.toBeNull();

      await revokeSession(ctx, token);
      expect(await getSession(ctx, token, now + 2)).toBeNull();
    });
  });
});
