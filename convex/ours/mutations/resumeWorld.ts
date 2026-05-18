import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { manualResume } from '../lib/worldState';
import { getInstructorSession } from '../lib/instructorAuth';

// Instructor-only manual override — wakes the town outside its
// scheduled hours (e.g., a make-up session). Cron won't auto-freeze
// until schedule and override agree (i.e., a real frozen window).
export default mutation({
  args: { instructorSessionToken: v.string() },
  handler: async (ctx, { instructorSessionToken }) => {
    const now = Date.now();
    const session = await getInstructorSession(ctx, instructorSessionToken, now);
    if (!session) {
      throw new Error('resumeWorld: invalid or expired instructor session');
    }
    await manualResume(ctx, { now });
  },
});
