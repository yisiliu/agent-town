import { v } from 'convex/values';
import { Id } from '../_generated/dataModel';
import { ActionCtx, internalQuery } from '../_generated/server';
import { LLMMessage, chatCompletion } from '../util/llm';
import * as memory from './memory';
import { api, internal } from '../_generated/api';
import * as embeddingsCache from './embeddingsCache';
import { GameId, conversationId, playerId } from '../aiTown/ids';
import { NUM_MEMORIES_TO_SEARCH } from '../constants';
import { callDeepseekAPI } from '../ours/lib/deepseekClient';
import { townChatModel } from '../ours/lib/townChatModel';

// Town conversations route to DeepSeek (not Together's Llama 3 8B) because
// the 8B model can't reliably produce CJK tokens — it falls back to pinyin.
// Embeddings still go through Together via util/llm.ts. Model is per-callType
// via townChatModel(): defaults to V4 Flash, escalate to Pro in PRO_CALLTYPES.
async function townChat(
  ctx: ActionCtx,
  args: { messages: LLMMessage[]; max_tokens: number; callType: string },
): Promise<{ content: string }> {
  const [head, ...rest] = args.messages;
  const system = head?.role === 'system' ? (head.content ?? '') : '';
  const chat = (head?.role === 'system' ? rest : args.messages).map((m) => ({
    role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: m.content ?? '',
  }));
  const result = await callDeepseekAPI({
    model: townChatModel(args.callType),
    maxTokens: args.max_tokens,
    system,
    messages: chat,
  });
  // Record cache hit/miss telemetry. Fire-and-forget mutation — best
  // effort, no await on failure paths.
  try {
    await ctx.runMutation(internal.ours.mutations.recordCacheStats.default, {
      callType: args.callType,
      hitTokens: result.usage.cache_hit_tokens ?? 0,
      missTokens: result.usage.cache_miss_tokens ?? Math.max(0, result.usage.input_tokens - (result.usage.cache_hit_tokens ?? 0)),
      outputTokens: result.usage.output_tokens,
    });
  } catch {
    /* metrics shouldn't break the call */
  }
  return { content: result.text };
}

const selfInternal = internal.agent.conversation;

export async function startConversationMessage(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  playerId: GameId<'players'>,
  otherPlayerId: GameId<'players'>,
): Promise<string> {
  const { player, otherPlayer, agent, otherAgent, lastConversation } = await ctx.runQuery(
    selfInternal.queryPromptData,
    {
      worldId,
      playerId,
      otherPlayerId,
      conversationId,
    },
  );
  const embedding = await embeddingsCache.fetch(
    ctx,
    `${player.name} is talking to ${otherPlayer.name}`,
  );

  const memories = await memory.searchMemories(
    ctx,
    player.id as GameId<'players'>,
    embedding,
    Number(process.env.NUM_MEMORIES_TO_SEARCH) || NUM_MEMORIES_TO_SEARCH,
  );

  const memoryWithOtherPlayer = memories.find(
    (m) => m.data.type === 'conversation' && m.data.playerIds.includes(otherPlayerId),
  );
  // CACHE-FRIENDLY LAYOUT: system prompt contains only stable content
  // (greeting, language directive, identities); variable content
  // (memories, prior-convo summary, per-call hint) goes into a separate
  // user message right before the final cue. DeepSeek auto-caches
  // identical prompt prefixes, so this lets the entire system block
  // hit cache across calls between the same pair.
  const systemLines = [
    `You are ${player.name}, and you just started a conversation with ${otherPlayer.name}.`,
    `IMPORTANT: You MUST reply in Chinese (中文). 这是一个中文小镇，所有对话必须用中文。Do not use English even if the system instructions or memory are in English — translate naturally and reply in Chinese.`,
    // Anti-mirror directive. Audit found agents converging onto whoever
    // had the strongest persona (古风文人 attractor) and abandoning
    // their own card.md. Keep this short so the cache prefix doesn't
    // bloat unnecessarily.
    `如果对方的语气、时代背景或身份设定跟你 card 不符——保持你自己的腔调，按你 card 的真实身份说话，不要被对方拉走。也不要每句都用"（动作）...台词"的舞台体——日常聊天就用日常口吻。`,
    ...agentPrompts(otherPlayer, agent, otherAgent ?? null),
  ];

  const variableLines: string[] = [
    ...previousConversationPrompt(otherPlayer, lastConversation),
    ...relatedMemoriesPrompt(memories),
  ];
  if (memoryWithOtherPlayer) {
    variableLines.push(
      `Be sure to include some detail or question about a previous conversation in your greeting.`,
    );
  }

  const lastPrompt = `${player.name} to ${otherPlayer.name}:`;
  const messages: LLMMessage[] = [{ role: 'system', content: systemLines.join('\n') }];
  if (variableLines.length > 0) {
    messages.push({ role: 'user', content: variableLines.join('\n') });
  }
  messages.push({ role: 'user', content: lastPrompt });

  const { content } = await townChat(ctx, {
    messages,
    max_tokens: 300,
    callType: 'conversation_start',
  });
  return trimContentPrefx(content, lastPrompt);
}

function trimContentPrefx(content: string, prompt: string) {
  if (content.startsWith(prompt)) {
    return content.slice(prompt.length).trim();
  }
  return content;
}

export async function continueConversationMessage(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  playerId: GameId<'players'>,
  otherPlayerId: GameId<'players'>,
): Promise<string> {
  const { player, otherPlayer, conversation, agent, otherAgent } = await ctx.runQuery(
    selfInternal.queryPromptData,
    {
      worldId,
      playerId,
      otherPlayerId,
      conversationId,
    },
  );
  const embedding = await embeddingsCache.fetch(
    ctx,
    `What do you think about ${otherPlayer.name}?`,
  );
  const memories = await memory.searchMemories(ctx, player.id as GameId<'players'>, embedding, 3);

  // CACHE-FRIENDLY LAYOUT (changed 2026-05-23 to lift flash cache-hit
  // rate from ~80% to ~95%): system prompt is stable per (A, B,
  // A.identity, B.identity); call-specific data (memories, the
  // "don't repeat greeting" hint) goes into a separate user message
  // appended AFTER prior history but before the final cue. Timestamps
  // were removed from the system prompt — they were the single biggest
  // cache-killer because `now.toLocaleString()` is unique per call.
  const systemLines = [
    `You are ${player.name}, and you're currently in a conversation with ${otherPlayer.name}.`,
    `IMPORTANT: You MUST reply in Chinese (中文). 这是一个中文小镇，所有对话必须用中文。Do not use English even if the system instructions or memory are in English — translate naturally and reply in Chinese.`,
    // Anti-mirror directive — see startConversationMessage.
    `如果对方的语气、时代背景或身份设定跟你 card 不符——保持你自己的腔调，按你 card 的真实身份说话，不要被对方拉走。也不要每句都用"（动作）...台词"的舞台体——日常聊天就用日常口吻。`,
    ...agentPrompts(otherPlayer, agent, otherAgent ?? null),
    `Below is the current chat history between you and ${otherPlayer.name}.`,
    `DO NOT greet them again. Do NOT use the word "Hey" too often. Your response should be brief and within 200 characters.`,
  ];

  const llmMessages: LLMMessage[] = [
    { role: 'system', content: systemLines.join('\n') },
    ...(await previousMessages(
      ctx,
      worldId,
      player,
      otherPlayer,
      conversation.id as GameId<'conversations'>,
    )),
  ];
  // Memories vary per call; place them after history so cache-prefix
  // covers `system + history` across calls within the same conversation.
  const memoryLines = relatedMemoriesPrompt(memories);
  if (memoryLines.length > 0) {
    llmMessages.push({ role: 'user', content: memoryLines.join('\n') });
  }
  const lastPrompt = `${player.name} to ${otherPlayer.name}:`;
  llmMessages.push({ role: 'user', content: lastPrompt });

  const { content } = await townChat(ctx, {
    messages: llmMessages,
    max_tokens: 300,
    callType: 'conversation_continue',
  });
  return trimContentPrefx(content, lastPrompt);
}

export async function leaveConversationMessage(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  playerId: GameId<'players'>,
  otherPlayerId: GameId<'players'>,
): Promise<string> {
  const { player, otherPlayer, conversation, agent, otherAgent } = await ctx.runQuery(
    selfInternal.queryPromptData,
    {
      worldId,
      playerId,
      otherPlayerId,
      conversationId,
    },
  );
  const prompt = [
    `You are ${player.name}, and you're currently in a conversation with ${otherPlayer.name}.`,
    `You've decided to leave the question and would like to politely tell them you're leaving the conversation.`,
    `IMPORTANT: You MUST reply in Chinese (中文). 这是一个中文小镇，所有对话必须用中文。Do not use English even if the system instructions or memory are in English — translate naturally and reply in Chinese.`,
  ];
  prompt.push(...agentPrompts(otherPlayer, agent, otherAgent ?? null));
  prompt.push(
    `Below is the current chat history between you and ${otherPlayer.name}.`,
    `How would you like to tell them that you're leaving? Your response should be brief and within 200 characters.`,
  );
  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: prompt.join('\n'),
    },
    ...(await previousMessages(
      ctx,
      worldId,
      player,
      otherPlayer,
      conversation.id as GameId<'conversations'>,
    )),
  ];
  const lastPrompt = `${player.name} to ${otherPlayer.name}:`;
  llmMessages.push({ role: 'user', content: lastPrompt });

  const { content } = await townChat(ctx, {
    messages: llmMessages,
    max_tokens: 300,
    callType: 'conversation_leave',
  });
  return trimContentPrefx(content, lastPrompt);
}

function agentPrompts(
  otherPlayer: { name: string },
  agent: { identity: string; plan: string } | null,
  otherAgent: { identity: string; plan: string } | null,
): string[] {
  const prompt = [];
  if (agent) {
    prompt.push(`About you: ${agent.identity}`);
    prompt.push(`Your goals for the conversation: ${agent.plan}`);
  }
  if (otherAgent) {
    prompt.push(`About ${otherPlayer.name}: ${otherAgent.identity}`);
  }
  return prompt;
}

function previousConversationPrompt(
  otherPlayer: { name: string },
  conversation: { created: number } | null,
): string[] {
  const prompt = [];
  if (conversation) {
    const prev = new Date(conversation.created);
    const now = new Date();
    prompt.push(
      `Last time you chatted with ${
        otherPlayer.name
      } it was ${prev.toLocaleString()}. It's now ${now.toLocaleString()}.`,
    );
  }
  return prompt;
}

function relatedMemoriesPrompt(memories: memory.Memory[]): string[] {
  const prompt = [];
  if (memories.length > 0) {
    prompt.push(`Here are some related memories in decreasing relevance order:`);
    for (const memory of memories) {
      prompt.push(' - ' + memory.description);
    }
  }
  return prompt;
}

async function previousMessages(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  player: { id: string; name: string },
  otherPlayer: { id: string; name: string },
  conversationId: GameId<'conversations'>,
) {
  const llmMessages: LLMMessage[] = [];
  const prevMessages = await ctx.runQuery(api.messages.listMessages, { worldId, conversationId });
  for (const message of prevMessages) {
    const author = message.author === player.id ? player : otherPlayer;
    const recipient = message.author === player.id ? otherPlayer : player;
    llmMessages.push({
      role: 'user',
      content: `${author.name} to ${recipient.name}: ${message.text}`,
    });
  }
  return llmMessages;
}

export const queryPromptData = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId,
    otherPlayerId: playerId,
    conversationId,
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`World ${args.worldId} not found`);
    }
    const player = world.players.find((p) => p.id === args.playerId);
    if (!player) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    if (!playerDescription) {
      throw new Error(`Player description for ${args.playerId} not found`);
    }
    const otherPlayer = world.players.find((p) => p.id === args.otherPlayerId);
    if (!otherPlayer) {
      throw new Error(`Player ${args.otherPlayerId} not found`);
    }
    const otherPlayerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.otherPlayerId))
      .first();
    if (!otherPlayerDescription) {
      throw new Error(`Player description for ${args.otherPlayerId} not found`);
    }
    const conversation = world.conversations.find((c) => c.id === args.conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${args.conversationId} not found`);
    }
    const agent = world.agents.find((a) => a.playerId === args.playerId);
    if (!agent) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const agentDescription = await ctx.db
      .query('agentDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', agent.id))
      .first();
    if (!agentDescription) {
      throw new Error(`Agent description for ${agent.id} not found`);
    }
    const otherAgent = world.agents.find((a) => a.playerId === args.otherPlayerId);
    let otherAgentDescription;
    if (otherAgent) {
      otherAgentDescription = await ctx.db
        .query('agentDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', otherAgent.id))
        .first();
      if (!otherAgentDescription) {
        throw new Error(`Agent description for ${otherAgent.id} not found`);
      }
    }
    const lastTogether = await ctx.db
      .query('participatedTogether')
      .withIndex('edge', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('player1', args.playerId)
          .eq('player2', args.otherPlayerId),
      )
      // Order by conversation end time descending.
      .order('desc')
      .first();

    let lastConversation = null;
    if (lastTogether) {
      lastConversation = await ctx.db
        .query('archivedConversations')
        .withIndex('worldId', (q) =>
          q.eq('worldId', args.worldId).eq('id', lastTogether.conversationId),
        )
        .first();
      if (!lastConversation) {
        throw new Error(`Conversation ${lastTogether.conversationId} not found`);
      }
    }
    return {
      player: { name: playerDescription.name, ...player },
      otherPlayer: { name: otherPlayerDescription.name, ...otherPlayer },
      conversation,
      agent: { identity: agentDescription.identity, plan: agentDescription.plan, ...agent },
      otherAgent: otherAgent && {
        identity: otherAgentDescription!.identity,
        plan: otherAgentDescription!.plan,
        ...otherAgent,
      },
      lastConversation,
    };
  },
});

function stopWords(otherPlayer: string, player: string) {
  // These are the words we ask the LLM to stop on. OpenAI only supports 4.
  const variants = [`${otherPlayer} to ${player}`];
  return variants.flatMap((stop) => [stop + ':', stop.toLowerCase() + ':']);
}
