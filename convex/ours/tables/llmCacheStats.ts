import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Per-day aggregated cache hit/miss stats from DeepSeek API responses.
// One row per (dateUtc, callType). The recordCacheStats helper upserts
// these on every LLM call so we can audit cache effectiveness over
// time without DB-writing per-call.
export const llmCacheStats = defineTable({
  dateUtc: v.string(), // 'YYYY-MM-DD'
  callType: v.string(),
  callCount: v.number(),
  hitTokens: v.number(),
  missTokens: v.number(),
  outputTokens: v.number(),
  lastUpdated: v.number(),
}).index('dateCall', ['dateUtc', 'callType']);
