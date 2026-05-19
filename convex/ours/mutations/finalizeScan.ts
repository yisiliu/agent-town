import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { finalizeScanCore } from '../lib/finalizeScanCore';

// Thin Convex wrapper around finalizeScanCore. The real work lives in
// the lib so tests can exercise the full pipeline without going
// through a function reference.
//
// Caller (runTwinScans Node action) must pre-compute bcrypt hashes
// for the codes — V8 mutation runtime forbids setTimeout which
// bcryptjs uses internally.
const preparedCode = v.object({
  plaintext: v.string(),
  hash: v.string(),
});

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
    preparedCodes: v.optional(
      v.object({
        spectate: preparedCode,
        control: preparedCode,
        edit: preparedCode,
      }),
    ),
  },
  handler: async (ctx, args) => {
    return finalizeScanCore(ctx, args);
  },
});
