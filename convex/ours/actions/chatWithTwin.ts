'use node';

import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { internal } from '../../_generated/api';
import {
  findMatchingTwin,
  type ChatTwinCandidate,
} from '../lib/chatAuth';

// Private 1-on-1 chat with your own twin. Auth: pseudonym + control
// code (the same one issued at upload). Defense-in-depth re-verifies
// on every call — client-side state isn't trusted to gate the LLM hop.
//
// History is passed in and out as part of the request; not persisted
// server-side in v1. Refreshing the page loses history. Cheap and
// simple; can land a `chats` table later if needed.
//
// The card.markdown is the system prompt — the persona instructions
// distill rendered. Twin replies in-character per their Layer 0-5.
//
// Node action because bcryptjs (used to verify the control code) needs
// setTimeout, which Convex's V8 runtime forbids.
export default action({
  args: {
    pseudonym: v.string(),
    controlCode: v.string(),
    message: v.string(),
    history: v.array(
      v.object({
        role: v.union(v.literal('user'), v.literal('assistant')),
        content: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ref = internal as any;
    const candidates = (await ctx.runQuery(
      ref.ours.queries.twinsForChatByPseudonym.default,
      { pseudonym: args.pseudonym },
    )) as ChatTwinCandidate[];

    const auth = await findMatchingTwin(candidates, args.controlCode);
    if ('failure' in auth) {
      return { ok: false as const, reason: auth.failure };
    }

    const idempotencyKey = `chat:${auth.twinId}:${args.history.length}:${args.message.length}:${args.message.slice(0, 32)}`;
    const result = (await ctx.runAction(ref.ours.actions.llmRouter.default, {
      callType: 'private_chat',
      agentId: `chat:${auth.twinId}`,
      systemPrompt: auth.cardMarkdown,
      userMessages: [
        ...args.history,
        { role: 'user' as const, content: args.message },
      ],
      idempotencyKey,
    })) as { responseText: string };
    /* eslint-enable @typescript-eslint/no-explicit-any */

    return { ok: true as const, reply: result.responseText };
  },
});
