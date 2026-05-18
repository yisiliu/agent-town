import { internalAction } from '../../_generated/server';
import { internal } from '../../_generated/api';
import {
  computeScheduledStatus,
  type SessionConfig,
} from '../lib/sessionWindowCore';
import sessionsConfig from '../../../config/sessions.json';

// Spec §3.2 — town only ticks during scheduled class hours. The cron
// fires every minute; each tick recomputes the scheduled state from
// config and asks applyScheduledStatus to reconcile (no-op when state
// already matches, deferred when instructor override is in effect).
export default internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // The JSON import carries a comment key alongside `sessions`; the
    // SessionConfig parser ignores everything but `sessions`.
    const config: SessionConfig = {
      sessions: (sessionsConfig as { sessions?: SessionConfig['sessions'] })
        .sessions ?? [],
    };
    const status = computeScheduledStatus(config, now);

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ref = internal as any;
    await ctx.runMutation(ref.ours.mutations.applyScheduledStatus.default, {
      state: status.state,
      nextChange: status.nextChange,
      nextSessionStart: status.nextSessionStart,
      now,
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */
  },
});
