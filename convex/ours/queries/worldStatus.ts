import { query } from '../../_generated/server';
import { readWorldStatus } from '../lib/worldState';

// Public reactive query — the shell renders state + nextChange as a
// "next class in N min" countdown. Returns {state: 'frozen', nextChange: null}
// when no row exists yet (fresh deploy, no sessions configured).
export default query({
  args: {},
  handler: async (ctx) => {
    return readWorldStatus(ctx);
  },
});
