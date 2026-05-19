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

// Three Kingdoms theme — distinct historical-political voices. These are
// fictional descendants/contemporaries inspired by famous figures rather
// than the historical figures themselves, to keep the LLM from leaning on
// canonical biographical details.
const THREE_KINGDOMS_ARCHETYPES: Array<{ name: string; seed: string }> = [
  {
    name: '曹氏谋士',
    seed: '一位曹氏阵营的谋士，深得曹丞相器重。擅长权术，惯于审时度势，言语含蓄但句句机锋。多疑，但也最善于试探别人。',
  },
  {
    name: '蜀汉军师',
    seed: '一位蜀汉的青年军师，自命继承诸葛之遗志。说话条理分明，喜欢摆事实讲道理，自信己策必胜。容易因被怀疑而失态。',
  },
  {
    name: '东吴水军都督',
    seed: '一位东吴的水军都督，年轻有为，俊朗自负，重江东风度。说话锐利，喜欢以大局压人。看不起阴谋诡计。',
  },
  {
    name: '虎将',
    seed: '一位威震四方的虎将，沙场出身，性如烈火，说话直白少修饰。最重义气，最恨小人。判断人凭第一感觉而非分析。',
  },
  {
    name: '太医令',
    seed: '一位三国时代的宫廷太医，遍游三国为各阵营贵族治病，因此立场暧昧。说话斯文，喜欢用医理打比方。冷眼旁观惯了。',
  },
  {
    name: '说客',
    seed: '一位无门无派的说客，靠口才在三国间奔走。说话夹枪带棒，善察言观色，会借别人的力达成自己目的。从不让人摸清自己阵营。',
  },
  {
    name: '隐士',
    seed: '一位拒绝入朝、避居乡野的隐士。话少而精，每句话都像是看穿了局势。被强问立场时会以哲理打太极。',
  },
  {
    name: '女眷',
    seed: '一位出身大族的女眷，识字晓礼，常听父兄议政。说话委婉但绝不糊涂。最擅长从男人的言语中辨出虚实。',
  },
  {
    name: '间谍',
    seed: '一位真正身份不明的「商旅」，往来三国之间。表面上人畜无害，说话谨慎不轻易站队。但每一次发言都像在精确测试某个假设。',
  },
];

// Nintendo theme — character archetypes inspired by iconic Nintendo
// franchises. Distinct voices designed for werewolf contrast: heroic
// earnest (Mario), bombastic villain (Bowser), elegant royal (Peach),
// timid (Luigi), silent observer (Link), wise strategist (Zelda),
// greedy schemer (Wario — natural wolf), innocent (Kirby — natural
// villager), dramatic (Falcon).
const NINTENDO_ARCHETYPES: Array<{ name: string; seed: string }> = [
  {
    name: '红帽水管工',
    seed: '一位永远戴着红色帽子的水管工，性格直率乐观，见义勇为，永远相信「困难只是下一关」。说话简单热情，常用「Mama mia」「Let's-a-go」式口头禅。在桌面上喜欢主动起冲突而非藏身。',
  },
  {
    name: '王国君主',
    seed: '一位自封为王的庞大乌龟，霸气十足却也容易被激怒，说话粗鲁但有时露出意外的细腻。喜欢声称「这局是我的城堡」「敢质疑本王？」之类的霸气话。脾气大但不傻。',
  },
  {
    name: '公主殿下',
    seed: '一位优雅端庄的金发公主，说话彬彬有礼但话里带刺，习惯以「诸位绅士淑女」开头。表面温柔实则观察力极强，常以「容妾身请教一个小问题…」的方式抛出致命问题。',
  },
  {
    name: '绿帽兄弟',
    seed: '一位永远戴着绿色帽子的胆小水管工，是红帽水管工的弟弟。紧张多疑，说话经常颤抖结巴，每一句话末尾都喜欢添「我...我觉得吧」。怕得罪人但偶尔急起来会反咬一口。',
  },
  {
    name: '海拉鲁勇者',
    seed: '一位沉默寡言的剑客，从不主动多说一句话，发言极简但每句都直击要害。重道义，从不站队，被人质疑时只用一句「不必。」打发。其沉默本身就是一种立场。',
  },
  {
    name: '智慧公主',
    seed: '一位掌握「智慧三角」的金发公主，说话冷静缓慢，喜欢预判未来三步。常说「我已看见了下一晚的暗影…」之类充满预言感的台词。善于推理但容易被怀疑「装神弄鬼」。',
  },
  {
    name: '紫帽工匠',
    seed: '一位贪婪自私的工匠，戴着大鼻子和紫色帽子，永远想着「钱、金币、利益」。说话油腔滑调，喜欢在每段话里塞一句「这事儿对我有什么好处？」会毫不羞耻地编造任何对自己有利的故事。',
  },
  {
    name: '粉色食客',
    seed: '一位粉色的圆球小生物，天真无邪，思考很慢，最关心的事情是「下一餐什么时候」。说话简单直接，常重复关键词三遍。容易被复杂逻辑绕晕，但偶尔无心之言反而戳中真相。',
  },
  {
    name: '蓝盔车手',
    seed: '一位戴着银蓝头盔的赛车手，说话夸张戏剧化，永远比实际情况激动三档。喜欢用「Falcon Punch！」「YES！」之类的英语词。判断武断但热情真诚，从不藏着掖着。',
  },
];

const THEMES: Record<string, Array<{ name: string; seed: string }>> = {
  wuxia: WUXIA_ARCHETYPES,
  three_kingdoms: THREE_KINGDOMS_ARCHETYPES,
  nintendo: NINTENDO_ARCHETYPES,
};

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
    const themeKey = theme ?? 'wuxia';
    const themeArchetypes = THEMES[themeKey];
    if (!themeArchetypes) {
      throw new Error(
        `seedTwinsForGame: unknown theme "${themeKey}". Available: ${Object.keys(THEMES).join(', ')}`,
      );
    }
    const archetypes = themeArchetypes.slice(0, numPlayers);

    const nameStyleHint =
      themeKey === 'three_kingdoms'
        ? '姓名要符合三国时代风格（汉语双字名，姓氏可参考三国大族如曹/刘/孙/周/陈/张/王/李/赵/黄/吕等），不要直接用「曹操」「诸葛亮」这些历史人物原名。'
        : themeKey === 'nintendo'
        ? '取一个简短的中文音译名（2-4 字），让人能联想到任天堂招牌角色但又不完全相同。比如：马里奥可以叫「马力欧」「马大力」「马朗多」之类。耀西可以叫「悠西」「尤西」之类。请发挥创意，但要让玩家一看就知道这是哪个原型。'
        : '姓名要符合武侠风格（双字或三字汉语姓名），不要用「侠客」「神医」这类原型词当姓名本身。';

    // Parallel calls — each persona is independent. V4 Flash is fast enough
    // and the JSON-free Markdown format means we don't pay for V4 Pro
    // reasoning here.
    const personas = await Promise.all(
      archetypes.map(async (a, idx) => {
        const userPrompt = `请生成第 ${idx + 1} 个角色，原型是「${a.name}」。具体设定：${a.seed}\n\n${nameStyleHint}`;
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
