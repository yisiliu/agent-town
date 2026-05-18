import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Per-agent per-UTC-day frontier-spend bucket — backs the spec §3.5
// $0.50/twin/day kill-switch. We bucket on UTC date string ("YYYY-MM-DD")
// rather than a millisecond range because the cap is documented as a
// daily cap, and date arithmetic on strings is easier to reason about
// than range scans.
export const agentDailySpend = defineTable({
  agentId: v.string(),
  dateUtc: v.string(),
  costUsd: v.number(),
  lastUpdated: v.number(),
}).index('agent_date', ['agentId', 'dateUtc']);
