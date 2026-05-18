// Spec §3.2 — town only ticks during scheduled class hours. This file
// is the pure scheduling logic: given a config of (startUtc, endUtc)
// windows and a current timestamp, compute whether the town SHOULD be
// live or frozen and when the next transition happens. The cron at
// ours/crons/sessionWindow.ts wires this against the real config and
// applies the result via applyScheduledStatus.

export interface SessionConfig {
  sessions: Array<{ startUtc: string; endUtc: string }>;
}

export type WorldState = 'live' | 'frozen';

export interface WorldStatus {
  state: WorldState;
  // Absolute ms timestamp of the next scheduled flip, or null when
  // there's no future session in the config. Shell renders this as a
  // countdown.
  nextChange: number | null;
}

export interface ScheduledStatusResult extends WorldStatus {
  // When state is 'frozen', the next session's start timestamp (same as
  // nextChange unless we're past all sessions). When state is 'live',
  // null — the next session start is unknown without looking past
  // current session's end. The warmup cron uses this directly.
  nextSessionStart: number | null;
}

interface ParsedSession {
  start: number;
  end: number;
}

function parseAndSort(config: SessionConfig): ParsedSession[] {
  return config.sessions
    .map(({ startUtc, endUtc }) => ({
      start: Date.parse(startUtc),
      end: Date.parse(endUtc),
    }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end))
    .sort((a, b) => a.start - b.start);
}

export function computeScheduledStatus(
  config: SessionConfig,
  now: number,
): ScheduledStatusResult {
  const sessions = parseAndSort(config);

  for (const s of sessions) {
    // Inclusive start, exclusive end — match the test expectation. A
    // tick whose now === endUtc has already left the window.
    if (now >= s.start && now < s.end) {
      return {
        state: 'live',
        nextChange: s.end,
        nextSessionStart: null,
      };
    }
    if (now < s.start) {
      return {
        state: 'frozen',
        nextChange: s.start,
        nextSessionStart: s.start,
      };
    }
  }

  return { state: 'frozen', nextChange: null, nextSessionStart: null };
}
