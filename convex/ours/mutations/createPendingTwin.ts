import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { recordPending } from '../lib/uploadResultsStore';

// Internal — called by uploadTwin (Node action) after validation passes,
// before scans run. Writes the twins + cards rows in pending_scan state
// AND the uploadResults bridge row keyed by uploadSessionToken.
export default internalMutation({
  args: {
    pseudonym: v.string(),
    studentRealNameHash: v.string(),
    register: v.optional(
      v.union(v.literal('first_person'), v.literal('narrative_fiction')),
    ),
    markdown: v.string(),
    avatarStorageId: v.optional(v.string()),
    uploadSessionToken: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const twinId = await ctx.db.insert('twins', {
      pseudonym: args.pseudonym,
      studentRealNameHash: args.studentRealNameHash,
      avatarStorageId: args.avatarStorageId,
      state: 'pending_scan',
      register: args.register,
      createdAt: args.now,
    });

    const cardId = await ctx.db.insert('cards', {
      twinId,
      markdown: args.markdown,
      snapshotAt: args.now,
      piiScanStatus: 'pending',
      promptInjectionScanStatus: 'pending',
    });

    await ctx.db.patch(twinId, { cardId });

    await recordPending(ctx, {
      uploadSessionToken: args.uploadSessionToken,
      twinId,
      now: args.now,
    });

    return { twinId };
  },
});
