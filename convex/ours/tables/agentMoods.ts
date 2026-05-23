import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const moodValues = [
  'happy',
  'neutral',
  'sad',
  'angry',
  'excited',
  'anxious',
  'bored',
  'confused',
  'flirty',
  'mischievous',
  'jealous',
  'proud',
  'hopeful',
  'lonely',
  'surprised',
  'grateful',
] as const;
export type Mood = (typeof moodValues)[number];

// Per-agent mood state. Updated by mood-detection logic that runs after
// conversation messages, and by a periodic mood-decay cron that drifts
// mood back toward neutral when no recent events are driving it.
export const agentMoods = defineTable({
  agentId: v.string(),
  worldId: v.id('worlds'),
  mood: v.union(
    v.literal('happy'),
    v.literal('neutral'),
    v.literal('sad'),
    v.literal('angry'),
    v.literal('excited'),
    v.literal('anxious'),
    v.literal('bored'),
    v.literal('confused'),
    v.literal('flirty'),
    v.literal('mischievous'),
    v.literal('jealous'),
    v.literal('proud'),
    v.literal('hopeful'),
    v.literal('lonely'),
    v.literal('surprised'),
    v.literal('grateful'),
  ),
  moodReason: v.string(),
  updatedAt: v.number(),
}).index('by_agent', ['agentId']).index('by_world', ['worldId']);
