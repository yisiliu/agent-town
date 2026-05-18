import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../schema';
import {
  checkRateLimit,
  recordAttempt,
  unlockPseudonym,
  IP_MINUTE_CAP,
  IP_HOUR_CAP,
  PSEUDONYM_LOCKOUT_THRESHOLD,
} from '../ours/lib/rateLimit';

const modules = import.meta.glob('../**/*.ts');

const IP = '203.0.113.42';
const PSEUDONYM = 'rose-fox-7';

async function attempts(ctx: any, ip: string, n: number, now: number) {
  const results: { allowed: boolean; reason?: string }[] = [];
  for (let i = 0; i < n; i++) {
    const check = await checkRateLimit(ctx, { ip, pseudonym: PSEUDONYM }, now);
    if (check.allowed) {
      await recordAttempt(ctx, { ip, pseudonym: PSEUDONYM }, true, now);
    }
    results.push(check);
  }
  return results;
}

describe('rateLimit — IP minute window (5/min)', () => {
  it('first IP_MINUTE_CAP attempts allowed; one more rejected', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_000_000_000_000;
      const results = await attempts(ctx, IP, IP_MINUTE_CAP + 1, t0);

      for (let i = 0; i < IP_MINUTE_CAP; i++) {
        expect(results[i]!.allowed).toBe(true);
      }
      expect(results[IP_MINUTE_CAP]!.allowed).toBe(false);
      expect(results[IP_MINUTE_CAP]!.reason).toContain('minute');
    });
  });

  it('window resets after 60s', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_000_000_000_000;
      // Burn the budget.
      await attempts(ctx, IP, IP_MINUTE_CAP, t0);
      const blocked = await checkRateLimit(
        ctx,
        { ip: IP, pseudonym: PSEUDONYM },
        t0 + 30_000,
      );
      expect(blocked.allowed).toBe(false);

      // 61s after the window opened: new window, allowed again.
      const fresh = await checkRateLimit(
        ctx,
        { ip: IP, pseudonym: PSEUDONYM },
        t0 + 61_000,
      );
      expect(fresh.allowed).toBe(true);
    });
  });

  it('rejected attempts are logged in the rateLimits row (attempt counter advances)', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_000_000_000_000;
      await attempts(ctx, IP, IP_MINUTE_CAP, t0);
      // Rejection: we explicitly record the rejected attempt so the
      // counter reflects the actual blast pattern, not just the allowed ones.
      const check = await checkRateLimit(
        ctx,
        { ip: IP, pseudonym: PSEUDONYM },
        t0 + 1_000,
      );
      expect(check.allowed).toBe(false);
      await recordAttempt(
        ctx,
        { ip: IP, pseudonym: PSEUDONYM },
        false,
        t0 + 1_000,
        { rejected: true },
      );

      const row = await ctx.db
        .query('rateLimits')
        .withIndex('bucket_key', (q) =>
          q.eq('bucket', 'ip_minute').eq('key', IP),
        )
        .unique();
      expect(row).not.toBeNull();
      expect(row!.attempts).toBe(IP_MINUTE_CAP + 1);
    });
  });
});

describe('rateLimit — IP hour window (20/hr)', () => {
  it('IP_HOUR_CAP allowed across multiple minutes; next rejected', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_000_000_000_000;
      // Spread one attempt per second so the minute window never blocks first.
      // We want the hour window to be the one that fires.
      let now = t0;
      let allowed = 0;
      let rejected = 0;
      for (let i = 0; i < IP_HOUR_CAP + 1; i++) {
        const check = await checkRateLimit(
          ctx,
          { ip: IP, pseudonym: PSEUDONYM },
          now,
        );
        if (check.allowed) {
          await recordAttempt(
            ctx,
            { ip: IP, pseudonym: PSEUDONYM },
            true,
            now,
          );
          allowed++;
        } else {
          rejected++;
        }
        // Advance ~70s per attempt so we cycle minute windows but stay
        // inside the hour. IP_HOUR_CAP=20 → ~23 minutes elapsed.
        now += 70_000;
      }
      expect(allowed).toBe(IP_HOUR_CAP);
      expect(rejected).toBe(1);
    });
  });
});

describe('rateLimit — pseudonym lockout (10 failures)', () => {
  it('locks after PSEUDONYM_LOCKOUT_THRESHOLD failed attempts and stays locked', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_000_000_000_000;
      let now = t0;
      // Use a fresh IP each time so the IP windows never trip — we're
      // isolating the lockout behavior. (The IP windows would block at
      // 6, well before the lockout at 10.)
      for (let i = 0; i < PSEUDONYM_LOCKOUT_THRESHOLD; i++) {
        const check = await checkRateLimit(
          ctx,
          { ip: `198.51.100.${i}`, pseudonym: PSEUDONYM },
          now,
        );
        // Up to the threshold-th attempt, the row isn't locked yet.
        expect(check.allowed).toBe(true);
        await recordAttempt(
          ctx,
          { ip: `198.51.100.${i}`, pseudonym: PSEUDONYM },
          false,
          now,
        );
        now += 1_000;
      }

      const next = await checkRateLimit(
        ctx,
        { ip: '198.51.100.99', pseudonym: PSEUDONYM },
        now,
      );
      expect(next.allowed).toBe(false);
      expect(next.reason).toContain('locked');

      const row = await ctx.db
        .query('rateLimits')
        .withIndex('bucket_key', (q) =>
          q.eq('bucket', 'pseudonym_lockout').eq('key', PSEUDONYM),
        )
        .unique();
      expect(row).not.toBeNull();
      expect(row!.locked).toBe(true);
      expect(row!.failedAttempts).toBe(PSEUDONYM_LOCKOUT_THRESHOLD);
    });
  });

  it('successful attempts do not advance lockout counter', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_000_000_000_000;
      let now = t0;
      for (let i = 0; i < 3; i++) {
        await checkRateLimit(
          ctx,
          { ip: `198.51.100.${i}`, pseudonym: PSEUDONYM },
          now,
        );
        await recordAttempt(
          ctx,
          { ip: `198.51.100.${i}`, pseudonym: PSEUDONYM },
          true,
          now,
        );
        now += 1_000;
      }
      const row = await ctx.db
        .query('rateLimits')
        .withIndex('bucket_key', (q) =>
          q.eq('bucket', 'pseudonym_lockout').eq('key', PSEUDONYM),
        )
        .unique();
      // Row may not exist (successful attempts don't need it) or may exist
      // with failedAttempts at 0. Either is fine; what matters is no lock.
      if (row) {
        expect(row.failedAttempts).toBe(0);
        expect(row.locked).toBe(false);
      }
    });
  });

  it('unlockPseudonym clears the lock and resets failedAttempts', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const t0 = 1_000_000_000_000;
      let now = t0;
      for (let i = 0; i < PSEUDONYM_LOCKOUT_THRESHOLD; i++) {
        await checkRateLimit(
          ctx,
          { ip: `198.51.100.${i}`, pseudonym: PSEUDONYM },
          now,
        );
        await recordAttempt(
          ctx,
          { ip: `198.51.100.${i}`, pseudonym: PSEUDONYM },
          false,
          now,
        );
        now += 1_000;
      }

      const blocked = await checkRateLimit(
        ctx,
        { ip: '198.51.100.99', pseudonym: PSEUDONYM },
        now,
      );
      expect(blocked.allowed).toBe(false);

      await unlockPseudonym(ctx, PSEUDONYM, now + 100);

      const after = await checkRateLimit(
        ctx,
        { ip: '198.51.100.100', pseudonym: PSEUDONYM },
        now + 200,
      );
      expect(after.allowed).toBe(true);

      const row = await ctx.db
        .query('rateLimits')
        .withIndex('bucket_key', (q) =>
          q.eq('bucket', 'pseudonym_lockout').eq('key', PSEUDONYM),
        )
        .unique();
      expect(row!.locked).toBe(false);
      expect(row!.failedAttempts).toBe(0);
    });
  });
});
