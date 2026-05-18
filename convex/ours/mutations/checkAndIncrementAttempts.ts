import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { checkRateLimit, recordAttempt } from '../lib/rateLimit';

// Atomic check-then-record. The caller passes the prospective attempt
// outcome (`success`) when it knows it — for shell-side auth, this is
// typically called twice: once to gate-check (success unknown → pass
// `success: null` and don't record) and once after verification with the
// real outcome. The combined path here is convenient when the caller
// has the outcome up front (e.g., an API key check whose result is
// instantly known).
export default mutation({
  args: {
    ip: v.string(),
    pseudonym: v.string(),
    success: v.boolean(),
  },
  handler: async (ctx, { ip, pseudonym, success }) => {
    const now = Date.now();
    const check = await checkRateLimit(ctx, { ip, pseudonym }, now);
    if (!check.allowed) {
      // Log the rejected attempt for forensic visibility — recordAttempt
      // tracks it against the IP windows without advancing the lockout.
      await recordAttempt(ctx, { ip, pseudonym }, false, now, { rejected: true });
      return { allowed: false, reason: check.reason };
    }
    await recordAttempt(ctx, { ip, pseudonym }, success, now);
    return { allowed: true };
  },
});
