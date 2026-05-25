import { describe, it, expect } from 'vitest';
import {
  FESTIVAL_DURATION_MS,
  FESTIVAL_PRESETS,
  buildFestivalEventText,
  getFestivalPreset,
  listExpiredTownEventIds,
} from '../ours/lib/festivals';

describe('festivals lib', () => {
  it('defines at least 5 preset festivals including custom', () => {
    expect(FESTIVAL_PRESETS.length).toBeGreaterThanOrEqual(5);
    expect(FESTIVAL_PRESETS.some((p) => p.kind === 'custom')).toBe(true);
    expect(FESTIVAL_PRESETS.filter((p) => p.kind !== 'custom').every((p) => p.eventText.length > 0)).toBe(
      true,
    );
  });

  it('uses 1 real hour as 24 game hours until game clock exists', () => {
    expect(FESTIVAL_DURATION_MS).toBe(60 * 60 * 1000);
  });

  it('buildFestivalEventText returns preset copy', () => {
    const spring = getFestivalPreset('spring_festival');
    expect(buildFestivalEventText('spring_festival')).toBe(spring!.eventText);
  });

  it('buildFestivalEventText requires custom text', () => {
    expect(() => buildFestivalEventText('custom')).toThrow(/自定义/);
    expect(buildFestivalEventText('custom', ' 镇上办庙会 ')).toBe('镇上办庙会');
  });

  it('listExpiredTownEventIds filters by expiresAt', () => {
    const now = 1_000_000;
    const ids = listExpiredTownEventIds(
      [
        { _id: 'a', expiresAt: now - 1 },
        { _id: 'b', expiresAt: now + 1 },
        { _id: 'c' },
      ],
      now,
    );
    expect(ids).toEqual(['a']);
  });
});
