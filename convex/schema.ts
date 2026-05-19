import { defineSchema } from 'convex/server';
import { ourTables } from './ours/tables';

// SHELL-ONLY DEPLOYMENT (current state).
//
// The original design spread `upstream.tables` from `ai-town/upstream`
// here so a single Convex deployment held both our additive tables and
// ai-town's. That alias resolves in vitest + tsc but NOT in Convex's
// esbuild bundler at deploy time — see docs/running-locally.md §9.
//
// Until the composition is resolved (sync-ai-town script, repo refactor,
// or dual-deployment HTTP bridge per options 1-3 in the doc), this
// deployment only carries our tables. The upload flow doesn't need
// ai-town's tables; Task 15's twin→player mapping will need them.
//
// The schema test still asserts upstream tables present, via the
// vitest alias — see convex/tests/schema.test.ts.
export default defineSchema({
  ...ourTables,
});
