import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../schema';
import {
  computeScheduledStatus,
  type SessionConfig,
  type WorldStatus,
} from '../ours/lib/sessionWindowCore';
import {
  applyScheduledStatus,
  manualFreeze,
  manualResume,
  readWorldStatus,
  readNextSessionStart,
} from '../ours/lib/worldState';

const modules = import.meta.glob('../**/*.ts');

function cfg(...windows: Array<[string, string]>): SessionConfig {
  return {
    sessions: windows.map(([s, e]) => ({ startUtc: s, endUtc: e })),
  };
}

describe('computeScheduledStatus — pure session-window logic', () => {
  it('returns frozen with null nextChange when no sessions configured', () => {
    const out = computeScheduledStatus(cfg(), Date.UTC(2026, 4, 19));
    expect(out.state).toBe('frozen');
    expect(out.nextChange).toBeNull();
  });

  it('returns frozen + nextChange=startOfNextSession when before any session', () => {
    const config = cfg([
      '2026-05-21T02:00:00Z',
      '2026-05-21T03:30:00Z',
    ]);
    const now = Date.UTC(2026, 4, 21, 1, 0); // 1 hour before
    const out = computeScheduledStatus(config, now);
    expect(out.state).toBe('frozen');
    expect(out.nextChange).toBe(Date.UTC(2026, 4, 21, 2, 0));
  });

  it('returns live + nextChange=endOfSession when inside a session', () => {
    const config = cfg([
      '2026-05-21T02:00:00Z',
      '2026-05-21T03:30:00Z',
    ]);
    const now = Date.UTC(2026, 4, 21, 2, 45); // mid-session
    const out = computeScheduledStatus(config, now);
    expect(out.state).toBe('live');
    expect(out.nextChange).toBe(Date.UTC(2026, 4, 21, 3, 30));
  });

  it('treats startUtc as inclusive and endUtc as exclusive', () => {
    const config = cfg([
      '2026-05-21T02:00:00Z',
      '2026-05-21T03:30:00Z',
    ]);
    expect(
      computeScheduledStatus(config, Date.UTC(2026, 4, 21, 2, 0, 0)).state,
    ).toBe('live');
    expect(
      computeScheduledStatus(config, Date.UTC(2026, 4, 21, 3, 30, 0)).state,
    ).toBe('frozen');
  });

  it('points to the next future session after current ends, not the one we just left', () => {
    const config = cfg(
      ['2026-05-21T02:00:00Z', '2026-05-21T03:30:00Z'],
      ['2026-05-28T02:00:00Z', '2026-05-28T03:30:00Z'],
    );
    const now = Date.UTC(2026, 4, 21, 4, 0); // 30 min after first ends
    const out = computeScheduledStatus(config, now);
    expect(out.state).toBe('frozen');
    expect(out.nextChange).toBe(Date.UTC(2026, 4, 28, 2, 0));
  });

  it('sorts unsorted session windows correctly', () => {
    const config = cfg(
      ['2026-05-28T02:00:00Z', '2026-05-28T03:30:00Z'],
      ['2026-05-21T02:00:00Z', '2026-05-21T03:30:00Z'],
    );
    const now = Date.UTC(2026, 4, 20);
    expect(computeScheduledStatus(config, now).nextChange).toBe(
      Date.UTC(2026, 4, 21, 2, 0),
    );
  });

  it('returns frozen + null when after all sessions', () => {
    const config = cfg(['2026-05-21T02:00:00Z', '2026-05-21T03:30:00Z']);
    const out = computeScheduledStatus(config, Date.UTC(2026, 5, 1));
    expect(out.state).toBe('frozen');
    expect(out.nextChange).toBeNull();
  });
});

describe('worldState db helpers', () => {
  it('readWorldStatus returns frozen+null when never initialized', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const out: WorldStatus = await readWorldStatus(ctx);
      expect(out).toEqual({ state: 'frozen', nextChange: null });
    });
  });

  it('applyScheduledStatus writes when current state differs and is cron-owned', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const now = Date.UTC(2026, 4, 21, 2, 30);
      await applyScheduledStatus(ctx, {
        state: 'live',
        nextChange: Date.UTC(2026, 4, 21, 3, 30),
        now,
      });
      const after = await readWorldStatus(ctx);
      expect(after.state).toBe('live');
      expect(after.nextChange).toBe(Date.UTC(2026, 4, 21, 3, 30));
    });
  });

  it('applyScheduledStatus is a no-op when scheduled state already matches', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const now = Date.UTC(2026, 4, 21, 2, 30);
      await applyScheduledStatus(ctx, {
        state: 'live',
        nextChange: now + 60 * 60_000,
        now,
      });
      const before = await ctx.db.query('worldState').collect();
      const firstWrite = before[0]?.lastChangedAt;
      await applyScheduledStatus(ctx, {
        state: 'live',
        nextChange: now + 60 * 60_000,
        now: now + 1_000,
      });
      const after = await ctx.db.query('worldState').collect();
      // Same row; lastChangedAt unchanged because state didn't flip.
      expect(after[0]?.lastChangedAt).toBe(firstWrite);
    });
  });

  it('manualFreeze flips to frozen and marks instructor-owned (cron skips)', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const now = Date.UTC(2026, 4, 21, 2, 30);
      // Inside scheduled live window:
      await applyScheduledStatus(ctx, {
        state: 'live',
        nextChange: Date.UTC(2026, 4, 21, 3, 30),
        now,
      });
      // Instructor manually freezes mid-session:
      await manualFreeze(ctx, { now: now + 60_000 });
      expect((await readWorldStatus(ctx)).state).toBe('frozen');
      // Cron tick says "should be live" — but instructor-owned, so do NOT flip back.
      await applyScheduledStatus(ctx, {
        state: 'live',
        nextChange: Date.UTC(2026, 4, 21, 3, 30),
        now: now + 120_000,
      });
      expect((await readWorldStatus(ctx)).state).toBe('frozen');
    });
  });

  it('cron resumes ownership the next time scheduled state flips opposite the override', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const sessStart = Date.UTC(2026, 4, 21, 2, 0);
      const sessEnd = Date.UTC(2026, 4, 21, 3, 30);
      // Cron sets live at session start
      await applyScheduledStatus(ctx, {
        state: 'live',
        nextChange: sessEnd,
        now: sessStart,
      });
      // Instructor manually freezes
      await manualFreeze(ctx, { now: sessStart + 60_000 });
      // Session ends; scheduled state would now be 'frozen' anyway — cron should
      // reclaim ownership (override and schedule agree).
      await applyScheduledStatus(ctx, {
        state: 'frozen',
        nextChange: Date.UTC(2026, 4, 28, 2, 0),
        now: sessEnd,
      });
      // Next session: cron should resume normally because override agreed with schedule.
      await applyScheduledStatus(ctx, {
        state: 'live',
        nextChange: Date.UTC(2026, 4, 28, 3, 30),
        now: Date.UTC(2026, 4, 28, 2, 0),
      });
      expect((await readWorldStatus(ctx)).state).toBe('live');
    });
  });

  it('manualResume flips to live and marks instructor-owned', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const now = Date.UTC(2026, 4, 21, 0, 0); // Before any session
      await applyScheduledStatus(ctx, {
        state: 'frozen',
        nextChange: Date.UTC(2026, 4, 21, 2, 0),
        now,
      });
      await manualResume(ctx, { now: now + 60_000 });
      expect((await readWorldStatus(ctx)).state).toBe('live');
    });
  });

  it('readNextSessionStart returns the next session start when frozen, null when live', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      // Initial: frozen with future session
      await applyScheduledStatus(ctx, {
        state: 'frozen',
        nextChange: Date.UTC(2026, 4, 21, 2, 0),
        now: Date.UTC(2026, 4, 20),
      });
      expect(await readNextSessionStart(ctx)).toBe(
        Date.UTC(2026, 4, 21, 2, 0),
      );
      // Flip to live: there's no "next start" until current session ends
      await applyScheduledStatus(ctx, {
        state: 'live',
        nextChange: Date.UTC(2026, 4, 21, 3, 30),
        now: Date.UTC(2026, 4, 21, 2, 0),
      });
      expect(await readNextSessionStart(ctx)).toBeNull();
    });
  });
});
