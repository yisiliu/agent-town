// Model selection for the AI-town simulation path (townChat in
// agent/conversation.ts + agent/memory.ts: agent-to-agent dialogue and
// memory summary/importance/reflection).
//
// Default is V4 Flash — this is continuous ambient traffic and the
// dominant token bill. Escalate a specific callType to V4 Pro on demand
// by adding it to PRO_CALLTYPES (one line). The "ours" router
// (llmRouterCore) keeps its own separate tier table; this only governs
// the town simulation path.
//
// TOWN_CHAT_MODEL env still works as a global override that wins over
// the per-callType map — an ops escape hatch to force the whole town to
// one model without a deploy.
export const TOWN_FLASH_MODEL = 'deepseek-v4-flash';
export const TOWN_PRO_MODEL = 'deepseek-v4-pro';

export const PRO_CALLTYPES = new Set<string>([
  // Reflection synthesizes memories into higher-order beliefs that steer
  // future behavior — a bad one compounds. Runs rarely (threshold 2000)
  // so Pro cost is negligible.
  'memory_reflection',
  // NOTE: conversation_start used to be Pro too, but a 2026-05-25 audit
  // found it was 9% of calls yet 64% of the bill, while the rest of each
  // dialogue (conversation_continue) is flash anyway — Pro on the opener
  // alone buys an inconsistent quality profile. Flashed it.
]);

export function townChatModel(callType: string): string {
  const override = process.env.TOWN_CHAT_MODEL;
  if (override) return override;
  return PRO_CALLTYPES.has(callType) ? TOWN_PRO_MODEL : TOWN_FLASH_MODEL;
}
