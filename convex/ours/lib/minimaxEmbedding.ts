// MiniMax embo-01 client. 1536-dim vectors, mainland endpoint defaults.
// Wire shape confirmed by probeMinimaxEmbedding (mainland key):
//   POST {BASE}/v1/embeddings?GroupId={GID}
//   body: { model, texts: string[], type: 'db' | 'query' }
//   response: { vectors: number[][], total_tokens, base_resp: { status_code, status_msg } }
//
// We use type='db' for everything because the existing ai-town cache
// doesn't distinguish storage vs query — same text returns the same
// cached vector regardless of intent. MiniMax's db/query projection
// difference is small for similarity ranking purposes.

const DEFAULT_BASE_URL = 'https://api.minimax.chat';
const MODEL = 'embo-01';
// MiniMax recommends ≤32 texts per call. We batch defensively at 16
// to leave headroom for very long memory descriptions (token limit per
// request is also bounded server-side).
const BATCH_SIZE = 16;
const TIMEOUT_MS = 30_000;

export const MINIMAX_EMBEDDING_DIMENSION = 1536;

interface MinimaxResponse {
  vectors?: number[][];
  total_tokens?: number;
  base_resp?: { status_code?: number; status_msg?: string };
}

function endpoint(): string {
  const base = process.env.MINIMAX_BASE_URL ?? DEFAULT_BASE_URL;
  const groupId = process.env.MINIMAX_GROUP_ID;
  if (!groupId) throw new Error('minimax: MINIMAX_GROUP_ID env var is missing');
  return `${base}/v1/embeddings?GroupId=${encodeURIComponent(groupId)}`;
}

function apiKey(): string {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) throw new Error('minimax: MINIMAX_API_KEY env var is missing');
  return key;
}

async function callOnce(texts: string[]): Promise<number[][]> {
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
      body: JSON.stringify({ model: MODEL, texts, type: 'db' }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`minimax ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as MinimaxResponse;
    const status = json.base_resp?.status_code ?? -1;
    if (status !== 0) {
      throw new Error(`minimax base_resp ${status}: ${json.base_resp?.status_msg ?? 'unknown'}`);
    }
    const vectors = json.vectors;
    if (!Array.isArray(vectors) || vectors.length !== texts.length) {
      throw new Error(`minimax: expected ${texts.length} vectors, got ${vectors?.length}`);
    }
    return vectors;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchMinimaxBatch(
  texts: string[],
): Promise<{ embeddings: number[][]; tokens: number }> {
  const all: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const slice = texts.slice(i, i + BATCH_SIZE);
    const vecs = await callOnce(slice);
    all.push(...vecs);
  }
  return { embeddings: all, tokens: 0 };
}

export async function fetchMinimaxSingle(text: string): Promise<{ embedding: number[] }> {
  const { embeddings } = await fetchMinimaxBatch([text]);
  return { embedding: embeddings[0]! };
}
