'use node';

import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { internal } from '../../_generated/api';
import {
  findMatchingTwin,
  type ChatTwinCandidate,
} from '../lib/chatAuth';

// Public action — auth gate for the chat UI. Calls internal query
// to fetch candidates (twin rows + control hashes), then bcrypt-
// compares in Node runtime. Returns minimal metadata on success;
// doesn't leak the card content (that ships only via chatWithTwin).
export default action({
  args: {
    pseudonym: v.string(),
    controlCode: v.string(),
  },
  handler: async (ctx, { pseudonym, controlCode }) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ref = internal as any;
    const candidates = (await ctx.runQuery(
      ref.ours.queries.twinsForChatByPseudonym.default,
      { pseudonym },
    )) as ChatTwinCandidate[];
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const result = await findMatchingTwin(candidates, controlCode);
    if ('failure' in result) {
      return { ok: false as const, reason: result.failure };
    }
    return {
      ok: true as const,
      twinId: result.twinId,
      pseudonym,
    };
  },
});
