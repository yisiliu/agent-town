import type { RunpodCallArgs, RunpodCallResult } from './llmRouterCore';

// RunPod serverless inference wrapper. Spec §5.1 local tier = Qwen3-7B
// behind a RunPod warm replica. The deployed endpoint speaks an OpenAI-
// compatible body shape under RunPod's `input` envelope; this client
// translates from the AnthropicCallArgs-shaped contract used by
// llmRouterCore (deliberately the same I/O shape on both tiers — keeps
// the dispatch branch trivial).

const RUNPOD_BASE = 'https://api.runpod.ai/v2';

function endpoint(): string {
  const id = process.env.RUNPOD_ENDPOINT_ID;
  if (!id) throw new Error('runpod: RUNPOD_ENDPOINT_ID env var is missing');
  return `${RUNPOD_BASE}/${id}/runsync`;
}

function apiKey(): string {
  const key = process.env.RUNPOD_API_KEY;
  if (!key) throw new Error('runpod: RUNPOD_API_KEY env var is missing');
  return key;
}

// Conservative timeout — RunPod cold start can be 5-10s on a scale-to-zero
// pod, but anything past 8s and we'd rather degrade-to-silence (spec §3.5)
// than block the tick.
const TIMEOUT_MS = 8_000;

export async function callRunpodAPI(
  req: RunpodCallArgs,
): Promise<RunpodCallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint(), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify({
        input: {
          model: req.model,
          system: req.system,
          messages: req.messages,
          max_tokens: req.maxTokens,
          temperature: 0.7,
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`runpod: ${res.status}: ${(await res.text()).slice(0, 120)}`);
    }
    return parseRunpodReply(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

// RunPod's outer envelope: `{ status, output, id }`. The endpoint we
// deploy returns an OpenAI-shaped output: `{ choices: [{message: {content}}], usage }`.
// Parsing is exported so the action layer can be tested without network.
export function parseRunpodReply(raw: unknown): RunpodCallResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error('runpod: empty reply');
  }
  const env = raw as { status?: string; output?: unknown };
  if (env.status && env.status !== 'COMPLETED') {
    throw new Error(`runpod: status ${env.status}`);
  }
  const output = env.output as
    | {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      }
    | undefined;
  const text = output?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new Error('runpod: missing output.choices[0].message.content');
  }
  return {
    text,
    usage: {
      input_tokens: output?.usage?.prompt_tokens ?? 0,
      output_tokens: output?.usage?.completion_tokens ?? 0,
    },
  };
}

// Tiny "ping" call used by the warmup cron to keep the pod warm ahead of
// a scheduled class start. We don't care about the reply — only that the
// pod stays alive — so we swallow errors here (the cron is best-effort).
export async function warmupPing(): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      await fetch(endpoint(), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey()}`,
        },
        body: JSON.stringify({
          input: {
            model: 'qwen3-7b',
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
          },
        }),
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Best-effort. The first real call at class start triggers a cold
    // start if this fails; spec §3.5 already covers that path.
  }
}
