// Dungeon bridge — pure helpers that link ai-town's agent state into the
// Interactions framework. No Convex dependencies; safe to unit-test.

export interface AgentSeed {
  // ai-town player fields
  name: string;
  description: string;
  character: string;
  // ai-town agent fields
  identity: string;
  plan: string;
}

// Construct a Markdown persona card from an ai-town agent's public state.
// The card.markdown format is loose — werewolf's prompts.ts uses the full
// card text as the system-prompt persona, so what matters is voice signal
// and behavioral hints, not strict Layer 0-5 conformance.
//
// We synthesize a compact 4-section card from the agent's identity + plan
// rather than the full Layered-persona structure because (a) we don't have
// the source material to reconstruct Layers 0-5, and (b) the werewolf
// system prompt does NOT validate card structure — it just embeds the
// text.
export function synthesizeCardForAgent(seed: AgentSeed): string {
  const { name, description, character, identity, plan } = seed;
  // Trim long fields defensively so we don't blow up the system prompt.
  const trim = (s: string, max: number) =>
    s.length > max ? s.slice(0, max).replace(/\s+\S*$/, '') + '…' : s;
  return `---
family: celebrity
source: aitown_synth
---

# ${name}

## 一句话定位
${trim(description || identity || '小镇居民', 80)}

## 来历与身份
${trim(identity || description || '小镇的一位居民', 400)}

## 目标与心愿
${trim(plan || '过好每一天。', 200)}

## 性格与说话方式
- 你的形象（character sprite slot）：${character}
- 在桌面上保持你日常生活的语气和表达习惯。说话不必文绉绉，按你这个人物的真实口吻发挥。

## Worldview principles
- 你来自这个小镇，认识许多邻居。但在这局游戏里，你的目标是为你所在的阵营赢。
- 该说话时不要沉默——沉默 = 输。
- 如果你是好人，相信预言家的查验；如果你是狼人，记得伪装、误导、和队友（私下）配合。

## Example exchanges
**情境**：有人公开指控你为狼人。
**你**："（用你日常的语气）我？不是。理由是……（给出一个具体反驳）。"
`;
}

// Stable hash key for "this twin row represents this ai-town agent".
// Used by the bridge's idempotent find-or-create lookup so re-runs against
// the same (worldId, playerId) don't dupe rows.
export function dungeonTwinHashKey(worldId: string, playerId: string): string {
  return `aitown:${worldId}:${playerId}`;
}
