import { mutation } from '../../_generated/server';

// One-shot migration: rewrites the earlier seedNpcCards sentinel
// (`_npc_seed`) to the canonical `synth-npc-<pseudonym>` form so the
// instructor dashboard recognises these rows as AI-synthetic (not
// student-uploaded). Safe to re-run — only touches rows still on the
// old sentinel.

export default mutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('twins').take(500);
    let updated = 0;
    for (const t of rows) {
      if (t.studentRealNameHash !== '_npc_seed') continue;
      await ctx.db.patch(t._id, {
        studentRealNameHash: `synth-npc-${t.pseudonym}`,
      });
      updated++;
    }
    return { updated };
  },
});
