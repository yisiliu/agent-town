import { internalQuery } from '../../_generated/server';
import { readNextSessionStart } from '../lib/worldState';

// Internal — the runpodWarmup cron consults this each tick to decide
// whether to ping. Returns null when state is 'live' (already in
// session, no warmup needed) or when no future session is configured.
export default internalQuery({
  args: {},
  handler: async (ctx) => {
    return readNextSessionStart(ctx);
  },
});
