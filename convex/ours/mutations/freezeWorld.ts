import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { manualFreeze } from '../lib/worldState';
import { getInstructorSession } from '../lib/instructorAuth';

// Instructor-only manual override. Marks the row instructor-owned so
// the next cron tick won't flip back to 'live' even if the schedule
// says we're inside a session window.
export default mutation({
  args: { instructorSessionToken: v.string() },
  handler: async (ctx, { instructorSessionToken }) => {
    const now = Date.now();
    const session = await getInstructorSession(ctx, instructorSessionToken, now);
    if (!session) {
      throw new Error('freezeWorld: invalid or expired instructor session');
    }
    await manualFreeze(ctx, { now });
  },
});
