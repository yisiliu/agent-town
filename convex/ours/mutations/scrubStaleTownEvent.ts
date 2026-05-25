import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';

// One-off cleanup. An earlier town-event mechanism injected an old-format
// `[当前小镇事件: …]` line into agentDescription.identity (and from there into
// cards.markdown / the townEventState restore-snapshots) and never cleanly
// removed it on clear. The current setTownEvent appends a `当前小镇背景：…`
// suffix instead, so the bracketed old form is stale pollution — it leaves
// agents reading a contradictory leftover event. Strip the bracketed form
// everywhere it leaked. Idempotent; pass {dryRun:true} to preview.
//
// NOTE: only matches the bracketed `[当前小镇事件: …]` form — it does NOT
// touch the active `当前小镇背景：…` suffix, so a live event is preserved.
const STALE = /\s*\[当前小镇事件:[^\]]*\]/g;

export default internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const out = { dryRun: !!dryRun, agentDescriptions: 0, cards: 0, snapshots: 0, samples: [] as string[] };

    for (const d of await ctx.db.query('agentDescriptions').collect()) {
      const id = (d as { identity?: string }).identity;
      if (typeof id === 'string' && id.includes('[当前小镇事件:')) {
        const m = id.match(/\[当前小镇事件:[^\]]*\]/);
        if (m && out.samples.length < 3) out.samples.push(m[0]);
        out.agentDescriptions++;
        if (!dryRun) await ctx.db.patch(d._id, { identity: id.replace(STALE, '') });
      }
    }

    for (const c of await ctx.db.query('cards').collect()) {
      if (typeof c.markdown === 'string' && c.markdown.includes('[当前小镇事件:')) {
        out.cards++;
        if (!dryRun) await ctx.db.patch(c._id, { markdown: c.markdown.replace(STALE, '') });
      }
    }

    for (const s of await ctx.db.query('townEventState').collect()) {
      const orig = (s as { originalIdentities?: Record<string, string> }).originalIdentities ?? {};
      let changed = false;
      const cleaned: Record<string, string> = {};
      for (const [k, val] of Object.entries(orig)) {
        if (typeof val === 'string' && val.includes('[当前小镇事件:')) {
          changed = true;
          cleaned[k] = val.replace(STALE, '');
        } else {
          cleaned[k] = val as string;
        }
      }
      if (changed) {
        out.snapshots++;
        if (!dryRun) await ctx.db.patch(s._id, { originalIdentities: cleaned });
      }
    }

    return out;
  },
});
