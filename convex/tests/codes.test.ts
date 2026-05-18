import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../schema';
import {
  generate6DigitCode,
  hashCode,
  verifyCodeHash,
} from '../ours/lib/codes';
import {
  issueCodeFor,
  verifyCodeFor,
} from '../ours/lib/authCodeStore';

// Vitest reads test files under glob; convex-test discovers schema files
// via its own glob. Tell it where ours live so it can find the
// _generated/* prefix.
const modules = import.meta.glob('../**/*.ts');

function newTwin() {
  return {
    pseudonym: `rose-fox-${Math.floor(Math.random() * 1e6)}`,
    studentRealNameHash: 'sha256-fake',
    state: 'active' as const,
    createdAt: Date.now(),
  };
}

describe('lib/codes — pure crypto', () => {
  it('generate6DigitCode returns a 6-digit string', () => {
    for (let i = 0; i < 50; i++) {
      expect(generate6DigitCode()).toMatch(/^\d{6}$/);
    }
  });

  it('generate6DigitCode preserves leading zeros', () => {
    // Stat test: across many draws, leading-zero codes should appear with
    // probability ~10% (one in ten first digits should be 0). 200 samples
    // gives plenty of headroom to detect a bug that always strips zeros.
    let leadingZeros = 0;
    for (let i = 0; i < 200; i++) {
      if (generate6DigitCode().startsWith('0')) leadingZeros++;
    }
    expect(leadingZeros).toBeGreaterThan(0);
  });

  it('generate6DigitCode produces varied outputs', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) codes.add(generate6DigitCode());
    expect(codes.size).toBeGreaterThan(90);
  });

  it('hashCode returns a bcrypt-shaped string', async () => {
    const h = await hashCode('123456');
    expect(h).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(h.length).toBeGreaterThan(50);
  });

  it('hashCode produces different hashes for the same plaintext (random salt)', async () => {
    const a = await hashCode('123456');
    const b = await hashCode('123456');
    expect(a).not.toBe(b);
  });

  it('verifyCodeHash matches the original plaintext', async () => {
    const h = await hashCode('428193');
    expect(await verifyCodeHash('428193', h)).toBe(true);
  });

  it('verifyCodeHash rejects a wrong plaintext', async () => {
    const h = await hashCode('428193');
    expect(await verifyCodeHash('428192', h)).toBe(false);
    expect(await verifyCodeHash('999999', h)).toBe(false);
    expect(await verifyCodeHash('', h)).toBe(false);
  });

  it('verifyCodeHash uses bcrypt constant-time comparison (smoke check)', async () => {
    // bcrypt.compare iterates the full hash regardless of where the byte
    // mismatch occurs. We don't measure timing — too flaky on shared
    // runners — but we do exercise mismatches at both ends to confirm
    // bcrypt is what's running.
    const h = await hashCode('111111');
    expect(await verifyCodeHash('111112', h)).toBe(false);
    expect(await verifyCodeHash('211111', h)).toBe(false);
  });
});

describe('lib/authCodeStore — Convex db integration', () => {
  it('issueCodeFor writes one authCodes row per (twinId, scope) with a hashed plaintext', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const twinId = await ctx.db.insert('twins', newTwin());
      const { plaintext } = await issueCodeFor(ctx, twinId, 'control');

      expect(plaintext).toMatch(/^\d{6}$/);

      const rows = await ctx.db
        .query('authCodes')
        .withIndex('twin_scope', (q) =>
          q.eq('twinId', twinId).eq('scope', 'control'),
        )
        .collect();
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.hash).not.toBe(plaintext);
      expect(row.hash).toMatch(/^\$2[aby]\$/);
      expect(row.issuedAt).toBeGreaterThan(0);
      expect(row.reissueCountThisSemester).toBe(0);
    });
  });

  it('issuing the same (twinId, scope) twice replaces the prior code', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const twinId = await ctx.db.insert('twins', newTwin());
      const first = await issueCodeFor(ctx, twinId, 'control');
      const second = await issueCodeFor(ctx, twinId, 'control');

      expect(first.plaintext).not.toBe(second.plaintext);

      const rows = await ctx.db
        .query('authCodes')
        .withIndex('twin_scope', (q) =>
          q.eq('twinId', twinId).eq('scope', 'control'),
        )
        .collect();
      expect(rows).toHaveLength(1);
      // Reissue counter advances so Task 27's semester cap can enforce.
      expect(rows[0]!.reissueCountThisSemester).toBe(1);

      expect(await verifyCodeFor(ctx, twinId, 'control', first.plaintext)).toBe(
        false,
      );
      expect(
        await verifyCodeFor(ctx, twinId, 'control', second.plaintext),
      ).toBe(true);
    });
  });

  it('three scopes coexist independently for the same twin', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const twinId = await ctx.db.insert('twins', newTwin());
      const spec = await issueCodeFor(ctx, twinId, 'spectate');
      const ctrl = await issueCodeFor(ctx, twinId, 'control');
      const edit = await issueCodeFor(ctx, twinId, 'edit');

      const rows = await ctx.db
        .query('authCodes')
        .withIndex('twinId', (q) => q.eq('twinId', twinId))
        .collect();
      expect(rows.map((r) => r.scope).sort()).toEqual([
        'control',
        'edit',
        'spectate',
      ]);

      expect(
        await verifyCodeFor(ctx, twinId, 'spectate', spec.plaintext),
      ).toBe(true);
      expect(
        await verifyCodeFor(ctx, twinId, 'control', ctrl.plaintext),
      ).toBe(true);
      expect(await verifyCodeFor(ctx, twinId, 'edit', edit.plaintext)).toBe(
        true,
      );

      // Cross-scope must NOT verify (using a spectate code in control scope).
      expect(
        await verifyCodeFor(ctx, twinId, 'control', spec.plaintext),
      ).toBe(false);
    });
  });

  it('verifyCodeFor returns false for non-existent twinId/scope row', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const twinId = await ctx.db.insert('twins', newTwin());
      // No code issued — verify should not throw.
      expect(
        await verifyCodeFor(ctx, twinId, 'control', '000000'),
      ).toBe(false);
    });
  });

  it('verifyCodeFor against a wrong plaintext returns false', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const twinId = await ctx.db.insert('twins', newTwin());
      await issueCodeFor(ctx, twinId, 'control');
      expect(
        await verifyCodeFor(ctx, twinId, 'control', '000000'),
      ).toBe(false);
    });
  });

  it('codes for different twins do not collide', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const twinA = await ctx.db.insert('twins', newTwin());
      const twinB = await ctx.db.insert('twins', newTwin());
      const a = await issueCodeFor(ctx, twinA, 'control');
      const b = await issueCodeFor(ctx, twinB, 'control');

      expect(
        await verifyCodeFor(ctx, twinB, 'control', a.plaintext),
      ).toBe(false);
      expect(
        await verifyCodeFor(ctx, twinA, 'control', b.plaintext),
      ).toBe(false);
      expect(
        await verifyCodeFor(ctx, twinA, 'control', a.plaintext),
      ).toBe(true);
    });
  });
});
