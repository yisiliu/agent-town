import { query } from '../../_generated/server';

// Diagnostic: how many conversations exist, how many messages in the
// last hour, when was the last message. Used to debug "感觉没新对话了".
export default query({
  args: {},
  handler: async (ctx) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return { error: 'no default world' };

    const world = await ctx.db.get(status.worldId);
    if (!world) return { error: 'no world doc' };

    const activeConversations = (world.conversations as { id: string; participants: unknown[] }[]).map((c) => ({
      id: c.id,
      participantCount: c.participants.length,
    }));

    // recent messages by _creationTime
    const allMessages = await ctx.db
      .query('messages')
      .order('desc')
      .take(100);

    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const tenMinAgo = now - 10 * 60 * 1000;
    const messagesLastHour = allMessages.filter((m) => m._creationTime >= oneHourAgo).length;
    const messagesLast10Min = allMessages.filter((m) => m._creationTime >= tenMinAgo).length;
    const lastMessage = allMessages[0];
    const lastMessageAgoMs = lastMessage ? now - lastMessage._creationTime : null;

    return {
      now,
      activeConversations,
      activeConversationCount: activeConversations.length,
      messagesLastHour,
      messagesLast10Min,
      lastMessageAgoMs,
      lastMessagePreview: lastMessage
        ? {
            text: lastMessage.text.slice(0, 60),
            author: lastMessage.author,
            ago: Math.round(lastMessageAgoMs! / 1000) + 's ago',
          }
        : null,
    };
  },
});
