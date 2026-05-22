import { action } from '../../_generated/server';

// Probe that hits the MiniMax embeddings endpoint once to confirm the
// actual response dimension and shape before we wire it into the
// embeddingsCache hot path. Read-only — does not write to any table.
//
// Run with: bunx convex run ours/actions/probeMinimaxEmbedding
// Expects env vars: MINIMAX_API_KEY, MINIMAX_GROUP_ID
// Optional: MINIMAX_BASE_URL (defaults to https://api.minimaxi.chat)

export default action({
  args: {},
  handler: async () => {
    const apiKey = process.env.MINIMAX_API_KEY;
    const groupId = process.env.MINIMAX_GROUP_ID;
    if (!apiKey) throw new Error('probe: MINIMAX_API_KEY env var is missing');
    if (!groupId) throw new Error('probe: MINIMAX_GROUP_ID env var is missing');

    const base = process.env.MINIMAX_BASE_URL ?? 'https://api.minimaxi.chat';
    const url = `${base}/v1/embeddings?GroupId=${encodeURIComponent(groupId)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'embo-01',
        texts: ['你好，小镇。'],
        type: 'db',
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        body: text.slice(0, 500),
      };
    }

    const json = JSON.parse(text);
    const vectors = json?.vectors;
    const firstVec = Array.isArray(vectors) ? vectors[0] : undefined;
    return {
      ok: true,
      status: res.status,
      dimension: Array.isArray(firstVec) ? firstVec.length : null,
      responseKeys: Object.keys(json ?? {}),
      baseResp: json?.base_resp ?? null,
      sample: Array.isArray(firstVec) ? firstVec.slice(0, 4) : null,
    };
  },
});
