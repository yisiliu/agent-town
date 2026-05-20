import { v } from 'convex/values';
import { mutation } from '../../_generated/server';

// Set the active "town event" — a bit of context prepended to every alive
// agent's identity. Class demo: instructor changes the event, the town's
// conversations shift in ~30s as agents react.
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
    const prefix = `[当前小镇事件: ${args.eventText.trim()}]\n\n`;

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
      await ctx.db.patch(desc._id, { identity: `${prefix}${base}` });
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
