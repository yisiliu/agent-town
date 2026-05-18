import { ConvexReactClient } from 'convex/react';

// Single client instance, instantiated lazily on the client. The
// deployment URL comes from NEXT_PUBLIC_CONVEX_URL (Vercel envs) — the
// fallback "" makes the client useless but allows the module to load
// during build / Storybook / local dev without exploding.
let client: ConvexReactClient | null = null;

export function getConvexClient(): ConvexReactClient {
  if (client === null) {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? '';
    client = new ConvexReactClient(url);
  }
  return client;
}
