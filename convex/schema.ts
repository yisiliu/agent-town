import { defineSchema } from 'convex/server';
import upstream from 'ai-town/upstream';
import { ourTables } from './ours/tables';

// Single deployment, additive composition.
// upstream.tables is the unmodified a16z-infra/ai-town schema (pinned via the
// Task 2 additivity gate). Spreading by identity means every upstream table
// reference is shared, so tests can check `ours === theirs` and any future
// upstream rebase carries through without a manual re-declare. The
// 'ai-town/upstream' alias (vitest resolve + types/upstream.d.ts shim)
// keeps tsc from descending into ai-town-fork under our stricter root
// tsconfig — that subtree has its own tsconfig.
export default defineSchema({
  ...(upstream.tables as Record<string, ReturnType<typeof defineSchema>['tables'][string]>),
  ...ourTables,
});
