import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { finalizeScanCore } from '../lib/finalizeScanCore';

// Thin Convex wrapper around finalizeScanCore. The real work lives in
// the lib so tests can exercise the full pipeline without going
// through a function reference.
export default internalMutation({
  args: {
    twinId: v.id('twins'),
    uploadSessionToken: v.string(),
    outcome: v.union(
      v.object({ decision: v.literal('pass') }),
      v.object({
        decision: v.literal('block'),
        errors: v.array(v.string()),
      }),
    ),
    piiDecision: v.union(
      v.literal('pass'),
      v.literal('block'),
      v.literal('manual_review'),
    ),
    promptInjectionDecision: v.union(
      v.literal('pass'),
      v.literal('block'),
      v.literal('manual_review'),
    ),
    scanReasons: v.array(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    return finalizeScanCore(ctx, args);
  },
});
