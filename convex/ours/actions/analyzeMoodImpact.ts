import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { callDeepseekAPI } from '../lib/deepseekClient';

// Lightweight mood analysis — called after an agent generates a
// conversation message. Uses a tiny LLM call (DeepSeek V4 Flash) to
// classify how the exchange affects the agent's mood, then updates the
// mood row via setAgentMood mutation.
//
// Called from conversation.ts actions; fire-and-forget (errors are
// logged but never propagated to the conversation caller).

type MoodResult = { mood: string; reason: string } | null;

async function classifyMood(text: string): Promise<MoodResult> {
  const system = `你是一个心情分类器。分析这段对话内容对说话者的心情影响。

规则：
- 如果说话者表达了开心、满足、感激 → happy
- 如果说话者表达了悲伤、失落、委屈 → sad
- 如果说话者表达了愤怒、不满、被冒犯 → angry
- 如果说话者表达了兴奋、惊喜、期待 → excited
- 如果说话者表达了紧张、担心、害怕 → anxious
- 如果说话者表达了无聊、没劲、敷衍 → bored
- 如果说话者表达了困惑、迷茫、不确定 → confused
- 如果说话者表达了暧昧、调情、撩人 → flirty
- 如果说话者表达了捣蛋、恶作剧、腹黑、阴阳怪气 → mischievous
- 如果说话者表达了嫉妒、吃醋、酸溜溜 → jealous
- 如果说话者表达了骄傲、自豪、得意 → proud
- 如果说话者表达了希望、期待、乐观 → hopeful
- 如果说话者表达了孤独、寂寞、渴望陪伴 → lonely
- 如果说话者表达了惊讶、意外、震惊 → surprised
- 如果说话者表达了感激、感谢、温暖 → grateful
- 如果没有任何明显情绪倾向 → 回复 null

你必须严格回复一个 JSON 对象：{"mood":"happy|sad|angry|excited|anxious|bored|confused|flirty|mischievous|jealous|proud|hopeful|lonely|surprised|grateful","reason":"简短中文原因(10字以内)"}
或者如果没有明显情绪：null

只回复 JSON 或 null，不要回复其他内容。`;

  try {
    const result = await callDeepseekAPI({
      model: 'deepseek-v4-flash',
      maxTokens: 80,
      system,
      messages: [{ role: 'user', content: text }],
    });
    const trimmed = result.text.trim();
    if (trimmed === 'null' || trimmed === '') return null;
    const parsed = JSON.parse(trimmed);
    if (!parsed.mood || !parsed.reason) return null;
    return { mood: parsed.mood, reason: parsed.reason };
  } catch {
    // Classification failures are non-critical — just skip the update.
    return null;
  }
}

export default internalAction({
  args: {
    agentId: v.string(),
    worldId: v.id('worlds'),
    messageText: v.string(),
  },
  handler: async (ctx, args) => {
    const result = await classifyMood(args.messageText);
    if (!result) return { ok: true, moodChanged: false };

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ref = internal as any;
    await ctx.runMutation(ref.ours.mutations.setAgentMood.default, {
      agentId: args.agentId,
      worldId: args.worldId,
      mood: result.mood,
      moodReason: result.reason,
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { ok: true, moodChanged: true, mood: result.mood, reason: result.reason };
  },
});
