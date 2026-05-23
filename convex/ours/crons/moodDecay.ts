import { internalMutation } from '../../_generated/server';
import type { Mood } from '../tables/agentMoods';

// Mood decay — drifts every agent's mood one step back toward neutral
// when no event has refreshed it recently. Runs as a cron-backed
// mutation so transient Convex platform errors are auto-retried.

const DECAY_MS = 10 * 60 * 1000; // 10 minutes of no updates → decay one step

const decayTowardNeutral: Record<Mood, Mood> = {
  happy: 'neutral',
  angry: 'neutral',
  sad: 'neutral',
  excited: 'neutral',
  anxious: 'neutral',
  bored: 'neutral',
  confused: 'neutral',
  flirty: 'neutral',
  mischievous: 'neutral',
  jealous: 'neutral',
  proud: 'neutral',
  hopeful: 'neutral',
  lonely: 'neutral',
  surprised: 'neutral',
  grateful: 'neutral',
  neutral: 'neutral',
};

const decayReason: Record<Mood, string> = {
  happy: '有一阵子没什么特别的事了，心情趋于平静',
  angry: '气头过去了，情绪逐渐平复',
  sad: '情绪慢慢恢复中',
  excited: '兴奋劲过去了，心情趋于平静',
  anxious: '紧张感慢慢消散了',
  bored: '找到事情做了，不再无聊',
  confused: '理清头绪了',
  flirty: '春心平息了',
  mischievous: '恶作剧的心思过去了',
  jealous: '嫉妒心消散了',
  proud: '骄傲劲过去了',
  hopeful: '期待慢慢平复了',
  lonely: '找到人陪伴了',
  surprised: '惊讶感过去了',
  grateful: '感激之情慢慢淡了',
  neutral: '心情平静',
};

export default internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - DECAY_MS;

    // Fetch moods that are stale and not already neutral.
    const allMoods = await ctx.db.query('agentMoods').collect();
    const stale = allMoods.filter(
      (m) => m.mood !== 'neutral' && m.updatedAt < cutoff,
    );

    let decayed = 0;
    for (const row of stale) {
      const nextMood = decayTowardNeutral[row.mood] ?? 'neutral';
      // Only patch if the mood actually changes (happy→neutral, etc.)
      if (nextMood !== row.mood) {
        await ctx.db.patch(row._id, {
          mood: nextMood,
          moodReason: decayReason[row.mood] ?? '心情逐渐平复',
          updatedAt: now,
        });
        decayed += 1;
      }
    }

    return { ok: true, decayed, total: allMoods.length };
  },
});
