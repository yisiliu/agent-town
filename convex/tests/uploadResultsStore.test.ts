import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../schema';
import {
  generateUploadSessionToken,
  recordPending,
  recordActive,
  recordRejected,
  readUploadResult,
  clearUploadResult,
  UPLOAD_RESULT_TTL_MS,
} from '../ours/lib/uploadResultsStore';

const modules = import.meta.glob('../**/*.ts');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function seedTwin(ctx: any) {
  return ctx.db.insert('twins', {
    pseudonym: `test-twin-${Math.random()}`,
    studentRealNameHash: 'sha256-fake',
    state: 'pending_scan' as const,
    createdAt: Date.now(),
  });
}

describe('generateUploadSessionToken', () => {
  it('returns a url-safe random token >= 40 chars', () => {
    const t1 = generateUploadSessionToken();
    expect(t1).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(generateUploadSessionToken()).not.toBe(t1);
  });
});

describe('uploadResults — record/read/clear lifecycle', () => {
  it('recordPending → readUploadResult yields state=pending, no codes/errors', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const twinId = (await seedTwin(ctx)) as any;
      const tok = generateUploadSessionToken();
      const now = Date.UTC(2026, 4, 19, 12);
      await recordPending(ctx, { uploadSessionToken: tok, twinId, now });
      const res = await readUploadResult(ctx, tok, now);
      expect(res?.state).toBe('pending');
      expect(res?.codes).toBeUndefined();
      expect(res?.errors).toBeUndefined();
    });
  });

  it('recordActive transitions a pending row to active with codes', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const twinId = (await seedTwin(ctx)) as any;
      const tok = generateUploadSessionToken();
      const now = Date.UTC(2026, 4, 19, 12);
      await recordPending(ctx, { uploadSessionToken: tok, twinId, now });
      await recordActive(ctx, {
        uploadSessionToken: tok,
        codes: { spectate: '111111', control: '222222', edit: '333333' },
        now,
      });
      const res = await readUploadResult(ctx, tok, now);
      expect(res?.state).toBe('active');
      expect(res?.codes).toEqual({
        spectate: '111111',
        control: '222222',
        edit: '333333',
      });
    });
  });

  it('recordRejected transitions a pending row to rejected with errors', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const twinId = (await seedTwin(ctx)) as any;
      const tok = generateUploadSessionToken();
      const now = Date.UTC(2026, 4, 19, 12);
      await recordPending(ctx, { uploadSessionToken: tok, twinId, now });
      await recordRejected(ctx, {
        uploadSessionToken: tok,
        errors: ['PII (block): regex match: email'],
        now,
      });
      const res = await readUploadResult(ctx, tok, now);
      expect(res?.state).toBe('rejected');
      expect(res?.errors).toEqual(['PII (block): regex match: email']);
      expect(res?.codes).toBeUndefined();
    });
  });

  it('readUploadResult returns null past TTL', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const twinId = (await seedTwin(ctx)) as any;
      const tok = generateUploadSessionToken();
      const t0 = Date.UTC(2026, 4, 19, 12);
      await recordPending(ctx, { uploadSessionToken: tok, twinId, now: t0 });
      expect(await readUploadResult(ctx, tok, t0 + 1)).not.toBeNull();
      expect(
        await readUploadResult(ctx, tok, t0 + UPLOAD_RESULT_TTL_MS),
      ).toBeNull();
    });
  });

  it('clearUploadResult removes the row; second read returns null', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const twinId = (await seedTwin(ctx)) as any;
      const tok = generateUploadSessionToken();
      const now = Date.UTC(2026, 4, 19, 12);
      await recordPending(ctx, { uploadSessionToken: tok, twinId, now });
      expect(await clearUploadResult(ctx, tok)).toBe(true);
      expect(await readUploadResult(ctx, tok, now)).toBeNull();
      // Second clear is a no-op.
      expect(await clearUploadResult(ctx, tok)).toBe(false);
    });
  });

  it('recordActive throws when no pending row exists (defensive)', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await expect(
        recordActive(ctx, {
          uploadSessionToken: 'no-such-token',
          codes: { spectate: '111111', control: '222222', edit: '333333' },
          now: Date.now(),
        }),
      ).rejects.toThrow(/no row/);
    });
  });
});
