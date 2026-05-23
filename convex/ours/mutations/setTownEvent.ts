import { v } from 'convex/values';
import { mutation } from '../../_generated/server';

// Set the active "town event" — a bit of context APPENDED to every
// alive agent's identity as a low-weight tail note. Class demo:
// instructor changes the event, the town's conversations shift in
// ~30s as agents react.
//
// Append (not prepend) is intentional: putting the event line at the
// top of identity gave it primary-persona weight and the audit (2026-
// 05-23) found all conversations converging on the event topic.
//
// If an event is already set, the new event replaces it (without
// re-snapshotting originals — the existing snapshot stays as the source
// of truth for restoration).
export default mutation({
  args: {
    worldId: v.id('worlds'),
    eventText: v.string(),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.eventText.length === 0) {
      throw new Error('setTownEvent: eventText must be non-empty (use clearTownEvent to remove)');
    }

    const existing = await ctx.db
      .query('townEventState')
      .withIndex('by_world', (q) => q.eq('worldId', args.worldId))
      .unique();

    const now = Date.now();
    const expiresAt = args.durationMs ? now + args.durationMs : undefined;
    const suffix = `\n\n---\n当前小镇背景：${args.eventText.trim()}\n（这只是当前环境，不要让它主导你的话题或语气。按你 card 里的真实身份说话。）`;

    // Load all agentDescriptions for this world.
    const allDescs = await ctx.db
      .query('agentDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();

    // Build / update originalIdentities snapshot.
    const originals: Record<string, string> = existing?.originalIdentities
      ? { ...existing.originalIdentities }
      : {};

    let touched = 0;
    for (const desc of allDescs) {
      const key = desc._id as unknown as string;
      // If we don't already have a snapshot for this agent, save the
      // current identity BEFORE rewriting it. (If we already had a snapshot,
      // the existing one is the true original and we keep it.)
      if (!originals[key]) {
        originals[key] = desc.identity;
      }
      const base = originals[key];
      await ctx.db.patch(desc._id, { identity: `${base}${suffix}` });
      touched += 1;
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        eventText: args.eventText,
        setAt: now,
        expiresAt,
        originalIdentities: originals,
      });
    } else {
      await ctx.db.insert('townEventState', {
        worldId: args.worldId,
        eventText: args.eventText,
        setAt: now,
        expiresAt,
        originalIdentities: originals,
      });
    }
    return { ok: true, agentsAffected: touched, expiresAt };
  },
});
