'use node';

import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { callDeepseekAPI } from '../lib/deepseekClient';
import { LOCAL_MODEL } from '../lib/llmRouterCore';

// Generates N distinct LLM-rolled personas and inserts each as a (twins, cards)
// pair so they can participate in interactions (e.g. Werewolf) immediately.
// Unlike seedTownPlayers, this does NOT register them with the ai-town world —
// these twins exist purely as game participants. They can be wired into ai-town
// later via createAgentInline + the planned twin→player mapping.
//
// Theme parameter biases the cast; this v1 ships with a "wuxia" archetype
// preset because the user asked for it. Adding new presets is one const map.

const WUXIA_ARCHETYPES: Array<{ name: string; seed: string }> = [
  {
    name: '江湖侠客',
    seed: '一位重情重义的江湖侠客，年轻气盛，路见不平拔刀相助。说话直来直去，不擅心机。',
  },
  {
    name: '退隐书生',
    seed: '一位早年闯荡江湖、如今归隐田园的中年书生。说话慢条斯理，喜欢引经据典，城府较深。',
  },
  {
    name: '武林盟主',
    seed: '一位声望卓著的武林盟主，权谋老到，言辞威严，习惯以大局为重。私下并不那么仁慈。',
  },
  {
    name: '神医',
    seed: '一位医术超绝但脾气古怪的神医，对江湖恩怨不屑一顾，言语犀利，但内心其实关心人命。',
  },
  {
    name: '暗器高手',
    seed: '一位行踪诡秘的暗器高手，多疑寡言，习惯观察而非表态，被问起身份时常含糊其辞。',
  },
  {
    name: '酒馆老板娘',
    seed: '一位消息灵通的酒馆老板娘，泼辣健谈，喜欢八卦江湖中人。常以闲谈套话，实则心细如发。',
  },
  {
    name: '镖师',
    seed: '一位走南闯北、信誉至上的资深镖师，沉默寡言但出手稳重，重承诺，不轻易站队。',
  },
  {
    name: '复仇者',
    seed: '一位家族遭灭门、隐忍多年的复仇者，言语阴郁，目标明确，遇到刺激时容易暴怒。',
  },
  {
    name: '江湖骗子',
    seed: '一位巧舌如簧的江湖骗子，看起来人畜无害，实则随时在套话、打算盘。能编出听起来很真的故事。',
  },
];

const PERSONA_SYSTEM = `你正在为一个武侠主题的「狼人杀」游戏生成一个角色卡。角色卡是一段中文 Markdown，让另一个 AI 能完全代入这个角色发言、辩论、说谎和投票。

输出格式（严格按此结构，不要其它）：

\`\`\`markdown
---
family: celebrity
---

# {人物姓名}（{原型简称}）

## Layer 0: 一句话定位
（一句话，10-30 字，说清这个人是谁。）

## Layer 1: 来历
（80-150 字，说清籍贯、出身、师承或职业。）

## Layer 2: 性格
（80-150 字，重点说他/她「在桌面上」的表现：是话多还是话少？冲动还是慎重？容易激动还是冷静？倾向跟随还是质疑？）

## Layer 3: 说话方式
（60-120 字，描述语言风格：用词偏文/白，是否爱用比喻/古话，是否常打断别人，是否爱讲故事。）

## Layer 4: 江湖立场与偏见
（80-150 字，他/她对什么人有好感、对什么人有偏见？比如「不信书生」「最看不起拍马屁的」。这些偏见在狼人杀里会决定他/她怀疑谁、为谁辩护。）

## Layer 5: 招牌口头禅 / 标志性反应
（列 3-5 条，每条一句，是他/她常说的话或在压力下的标志性反应。）

## Worldview principles
（3-5 条，每条一句，说他/她坚信什么、不信什么。这是他/她做判断的底层逻辑。）

## Example exchanges
（2-3 条对话样例。格式：
**情境**：……
**他/她**："……"

样例要能体现他/她的说话方式和性格。）
\`\`\`

只输出 Markdown，不要其他解释。整段在 800-1400 字之间。`;

interface GeneratedPersona {
  pseudonym: string;
  markdown: string;
  archetype: string;
}

export default action({
  args: {
    numPlayers: v.number(),
    theme: v.optional(v.string()),
  },
  handler: async (ctx, { numPlayers, theme }) => {
    if (numPlayers < 4 || numPlayers > 12) {
      throw new Error('seedTwinsForGame: numPlayers must be 4..12');
    }
    if (theme && theme !== 'wuxia') {
      throw new Error(`seedTwinsForGame: only "wuxia" theme is implemented (got "${theme}")`);
    }

    const archetypes = WUXIA_ARCHETYPES.slice(0, numPlayers);

    // Parallel calls — each persona is independent. V4 Flash is fast enough
    // and the JSON-free Markdown format means we don't pay for V4 Pro
    // reasoning here.
    const personas = await Promise.all(
      archetypes.map(async (a, idx) => {
        const userPrompt = `请生成第 ${idx + 1} 个角色，原型是「${a.name}」。具体设定：${a.seed}\n\n姓名要符合武侠风格（双字或三字汉语姓名），不要用「侠客」「神医」这类原型词当姓名本身。`;
        const llm = await callDeepseekAPI({
          model: LOCAL_MODEL,
          maxTokens: 2000,
          system: PERSONA_SYSTEM,
          messages: [{ role: 'user', content: userPrompt }],
        });
        const md = extractMarkdown(llm.text);
        const name = extractName(md) ?? `${a.name}${idx + 1}`;
        return { pseudonym: name, markdown: md, archetype: a.name };
      }),
    );

    // De-dup pseudonyms (LLM occasionally collides on common wuxia names).
    const seen = new Set<string>();
    const uniq: GeneratedPersona[] = [];
    for (const p of personas) {
      let name = p.pseudonym;
      let suf = 0;
      while (seen.has(name)) {
        suf += 1;
        name = `${p.pseudonym}_${suf}`;
      }
      seen.add(name);
      uniq.push({ ...p, pseudonym: name });
    }

    // Insert via internal mutation (action → mutation is the Convex pattern;
    // we can't use ctx.db here because this is a Node action).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ref = internal as any;
    const ids = (await ctx.runMutation(
      ref.ours.mutations.insertGeneratedTwins.default,
      { personas: uniq },
    )) as Array<{ twinId: string; pseudonym: string }>;
    /* eslint-enable @typescript-eslint/no-explicit-any */

    return { count: ids.length, twins: ids };
  },
});

// Strip ```markdown ... ``` fences if the model wrapped them.
function extractMarkdown(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:markdown)?\s*([\s\S]*?)\s*```/);
  return (fence ? fence[1] : trimmed)!.trim();
}

// Parse the first H1 — "# 姓名（...）" — to extract the persona name.
function extractName(markdown: string): string | undefined {
  const m = markdown.match(/^#\s+([^\n（(]+)/m);
  if (!m) return undefined;
  return m[1]!.trim();
}
