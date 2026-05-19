import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';

// Internal — returns ALL twins with a given pseudonym (most-recent-
// first) along with their control-scope hash + card text. Actions
// that need to authenticate a chat session do bcrypt compare against
// these hashes themselves (V8 query runtime forbids setTimeout,
// which bcryptjs uses internally).
//
// Returning hashes is safe at this internal boundary — only Node
// actions can call this query, never the client.
export default internalQuery({
  args: { pseudonym: v.string() },
  handler: async (ctx, { pseudonym }) => {
    const twins = await ctx.db
      .query('twins')
      .withIndex('pseudonym', (q) => q.eq('pseudonym', pseudonym))
      .order('desc')
      .collect();
    const out: Array<{
      twinId: string;
      state: string;
      controlHash: string | null;
      cardMarkdown: string | null;
    }> = [];
    for (const twin of twins) {
      const controlCode = await ctx.db
        .query('authCodes')
        .withIndex('twin_scope', (q) =>
          q.eq('twinId', twin._id).eq('scope', 'control'),
        )
        .unique();
      const card = twin.cardId ? await ctx.db.get(twin.cardId) : null;
      out.push({
        twinId: twin._id,
        state: twin.state,
        controlHash: controlCode?.hash ?? null,
        cardMarkdown: card?.markdown ?? null,
      });
    }
    return out;
  },
});
