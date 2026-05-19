#!/usr/bin/env bash
# Sync ai-town's runtime tree into root convex/ so a single Convex
# deploy holds both surfaces. Without this, root convex/schema.ts can
# import ai-town's tables via a vitest alias (tests pass) but Convex's
# esbuild bundler can't resolve the alias and deploy fails — see
# docs/running-locally.md §9 + the b28700a commit that disabled
# composition.
#
# Strategy: copy by directory. The synced files live alongside our
# additive convex/ours/ — distinct namespaces, no collisions:
#   ai-town-fork/convex/aiTown/      → convex/aiTown/
#   ai-town-fork/convex/agent/       → convex/agent/
#   ai-town-fork/convex/engine/      → convex/engine/
#   ai-town-fork/convex/util/        → convex/util/
#   ai-town-fork/convex/constants.ts → convex/constants.ts
#   ai-town-fork/convex/ours/townHooks.ts
#                                    → convex/ours/townHooks.ts
#   ai-town-fork/data/               → data/  (relative imports
#                                            from convex/aiTown/X.ts
#                                            reference ../../data/Y)
#
# Skipped at root level (these conflict with our files or aren't
# runtime):
#   - schema.ts          (our convex/schema.ts composes both)
#   - crons.ts           (our convex/crons.ts — ai-town's would
#                         conflict; we re-register manually if needed)
#   - http.ts, init.ts, music.ts, messages.ts, testing.ts, world.ts
#     (post-MVP / not needed for the tick loop)
#
# Run idempotently — overwrites destination dirs each time.

set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
src="${repo}/ai-town-fork/convex"
data_src="${repo}/ai-town-fork/data"
dst="${repo}/convex"
data_dst="${repo}/data"

if [[ ! -d "$src" ]]; then
  echo "sync-ai-town: $src not found — is ai-town-fork checked out?"
  exit 1
fi

# Remove prior sync output so deleted upstream files don't linger.
for d in aiTown agent engine util; do
  rm -rf "${dst}/${d}"
done
rm -f "${dst}/constants.ts" "${dst}/messages.ts" \
      "${dst}/init.ts" "${dst}/world.ts" \
      "${dst}/music.ts" "${dst}/http.ts"
rm -rf "${data_dst}"

# Copy fresh.
cp -r "${src}/aiTown" "${dst}/aiTown"
cp -r "${src}/agent" "${dst}/agent"
cp -r "${src}/engine" "${dst}/engine"
cp -r "${src}/util" "${dst}/util"
cp "${src}/constants.ts" "${dst}/constants.ts"
cp "${src}/messages.ts" "${dst}/messages.ts"
cp "${src}/init.ts" "${dst}/init.ts"
cp "${src}/world.ts" "${dst}/world.ts"
# schema.ts: replaced by our composed convex/schema.ts
# crons.ts: conflicts with our convex/crons.ts; ai-town's crons (if
#   any land later) get manually re-registered there
# testing.ts: jest-style test scaffolding, not runtime
# music.ts: depends on the `replicate` npm package (AI-generated
#   ambient music). Skipped — adds a vendor + API key + isn't core.
# http.ts: only routes the Replicate webhook — skipped with music.ts.

# Strip ai-town's jest-style .test.ts files. Our root tsconfig's
# `convex/**/*.ts` include matches them, and they reference `expect` /
# `describe` globals not in scope here (our test runner is vitest with
# explicit imports; ai-town uses jest globals). The runtime doesn't
# need them either — Convex auto-skips *.test.ts at bundle time, but
# tsc still typechecks them and fails. Easier to just delete.
find "${dst}/aiTown" "${dst}/agent" "${dst}/engine" "${dst}/util" \
  -name '*.test.ts' -delete

# townHooks.ts lives under ours/ on the source side; mirror that.
mkdir -p "${dst}/ours"
cp "${src}/ours/townHooks.ts" "${dst}/ours/townHooks.ts"

# Data assets — referenced by ai-town's runtime via ../../data paths
# that, after sync, resolve to repo root.
cp -r "$data_src" "$data_dst"

echo "sync-ai-town: synced into convex/ (aiTown, agent, engine, util,"
echo "  constants.ts, ours/townHooks.ts) + data/ at repo root."
