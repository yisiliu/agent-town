import { query } from '../../_generated/server';

// Surface why rejected twins got rejected. Reads each rejected twin's
// card row and returns the scan statuses + scanReasons array verbatim.
// One-shot diagnostic — safe to leave deployed.
export default query({
  args: {},
  handler: async (ctx) => {
    const rejected = await ctx.db
      .query('twins')
      .withIndex('state', (q) => q.eq('state', 'rejected'))
      .collect();
    const out = [];
    for (const t of rejected) {
      let card = null;
      if (t.cardId) {
        const c = await ctx.db.get(t.cardId);
        if (c) {
          card = {
            piiScanStatus: c.piiScanStatus,
            promptInjectionScanStatus: c.promptInjectionScanStatus,
            scanReasons: c.scanReasons ?? [],
            markdownPreview: c.markdown.slice(0, 400),
          };
        }
      }
      out.push({
        twinId: t._id,
        pseudonym: t.pseudonym,
        createdAt: t.createdAt,
        card,
      });
    }
    return out;
  },
});
