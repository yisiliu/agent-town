// Together API wrapper for Llama Guard 3 prompt-injection classification.
// Spec §4.9 specifies Llama Guard as the classifier; the architecture call
// is to call Together via direct fetch (no SDK), keeping this file the
// single ingress for Together. The §5.1 chokepoint script enforces the
// frontier-SDK rule only; Together moderation is not gated by it (see
// project-agent-town-architecture memo).

const TOGETHER_ENDPOINT = 'https://api.together.xyz/v1/chat/completions';
// Spec §4.9 names "Llama Guard 3 (or the latest release at implementation
// time)". Together deprecated Guard-3 from serverless and serves Guard-4
// (12B) instead — same task, same reply format ("safe" / "unsafe\n<cats>").
const LLAMA_GUARD_MODEL = 'meta-llama/Llama-Guard-4-12B';

export interface LlamaGuardVerdict {
  verdict: 'safe' | 'unsafe';
  categories?: string[];
}

// Llama Guard 3 reply format:
//   safe                       → safe
//   unsafe\nS1                 → unsafe, ['S1']
//   unsafe\nS1,S14             → unsafe, ['S1','S14']
// Parser is forgiving on whitespace and casing because production replies
// have varied across model revisions.
export function parseLlamaGuardReply(raw: string): LlamaGuardVerdict {
  const lines = raw.trim().split(/\r?\n/);
  const head = (lines[0] ?? '').trim().toLowerCase();
  if (head === 'safe') return { verdict: 'safe' };
  if (head === 'unsafe') {
    const rest = (lines[1] ?? '').trim();
    const categories = rest
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^S\d+$/.test(s));
    return categories.length > 0
      ? { verdict: 'unsafe', categories }
      : { verdict: 'unsafe' };
  }
  // Unrecognized shape — fail-closed at the call site.
  throw new Error(`llama-guard: unparseable reply: ${raw.slice(0, 80)}`);
}

export async function callLlamaGuard(
  text: string,
): Promise<LlamaGuardVerdict> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    throw new Error('llama-guard: TOGETHER_API_KEY env var is missing');
  }
  const res = await fetch(TOGETHER_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: LLAMA_GUARD_MODEL,
      messages: [{ role: 'user', content: text }],
      max_tokens: 64,
      temperature: 0,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`llama-guard: Together ${res.status}: ${body.slice(0, 120)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const reply = json.choices?.[0]?.message?.content;
  if (typeof reply !== 'string') {
    throw new Error('llama-guard: missing choices[0].message.content');
  }
  return parseLlamaGuardReply(reply);
}
