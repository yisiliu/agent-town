'use client';

import { ConvexProvider as Provider } from 'convex/react';
import type { ReactNode, ComponentType } from 'react';
import { getConvexClient } from '@/lib/convex-client';

// Cast: convex@1.39 ships its own @types/react peer that conflicts with
// React 19's ReactNode (bigint added). The runtime contract is fine —
// it's a vendored-types collision skipLibCheck doesn't reach because the
// component value itself is what we use. Pin via cast at the boundary.
const ProviderAny = Provider as unknown as ComponentType<{
  client: ReturnType<typeof getConvexClient>;
  children?: ReactNode;
}>;

export function ConvexProvider({ children }: { children: ReactNode }) {
  return <ProviderAny client={getConvexClient()}>{children}</ProviderAny>;
}
