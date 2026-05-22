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
      "${dst}/init.ts" "${dst}/world.ts" "${dst}/testing.ts" \
      "${dst}/http.ts"
# NOTE: do NOT remove convex/music.ts — it's our hand-written stub
# replacing ai-town's Replicate-dependent original. See below.
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
cp "${src}/testing.ts" "${dst}/testing.ts"
# schema.ts: replaced by our composed convex/schema.ts
# crons.ts: conflicts with our convex/crons.ts; ai-town's crons (if
#   any land later) get manually re-registered there
# music.ts: ai-town's full music.ts imports `replicate` (AI music
#   generation). We hand-write a stub at convex/music.ts that exposes
#   only the public getBackgroundMusic query — what the MusicButton
#   needs — without the Replicate vendor. The stub is NOT removed
#   above and NOT overwritten here.
# http.ts: only routes the Replicate webhook — skipped with music.ts.

# Strip ai-town's jest-style .test.ts files. Our root tsconfig's
# `convex/**/*.ts` include matches them, and they reference `expect` /
# `describe` globals not in scope here (our test runner is vitest with
# explicit imports; ai-town uses jest globals). The runtime doesn't
# need them either — Convex auto-skips *.test.ts at bundle time, but
# tsc still typechecks them and fails. Easier to just delete.
find "${dst}/aiTown" "${dst}/agent" "${dst}/engine" "${dst}/util" \
  -name '*.test.ts' -delete

# Patch util/llm.ts:
#   1. Switch default EMBEDDING_DIMENSION from Ollama (1024, needs a
#      local ollama server) to Together. We have TOGETHER_API_KEY
#      already (for Llama Guard 4 in promptInjectionScan).
#   2. Bump TOGETHER_EMBEDDING_DIMENSION from 768 to 1024. Together
#      deprecated the 768-dim m2-bert model from serverless; their
#      only current serverless embedding is multilingual-e5-large-
#      instruct at 1024. Without bumping, getLLMConfig() throws on
#      the dimension assertion.
# Apply our patches over the synced ai-town files. Each patch is a
# small, additive (or idempotent) edit; the copies live under
# scripts/patches/ — outside convex/ so Convex's bundler doesn't try
# to bundle them as function modules.
#   - agentInputs.ts: adds createAgentInline input handler for the
#     LLM-seed action.
#   - conversation.ts: makes acceptInvite idempotent so the UI's
#     "Accept Invite" click doesn't throw when the engine already
#     transitioned the membership to walkingOver/participating.
cp "${repo}/scripts/patches/agentInputs.ts" "${dst}/aiTown/agentInputs.ts"
cp "${repo}/scripts/patches/conversation.ts" "${dst}/aiTown/conversation.ts"
# agent-conversation.ts: routes ai-town's 3 town-conversation prompts
# (start/continue/leave) through DeepSeek (callDeepseekAPI) instead of
# Together's Llama 3 8B — 8B can't reliably produce CJK and falls back to
# pinyin. Also includes the "reply in Chinese" directive baked into each
# prompt array.
cp "${repo}/scripts/patches/agent-conversation.ts" "${dst}/agent/conversation.ts"
# agent-embeddingsCache.ts + agent-memory.ts: gated swap to MiniMax
# embo-01 embeddings (1536-dim, Chinese-native) via
# MINIMAX_EMBEDDINGS_ENABLED=1. Gate-off falls back to ai-town's
# util/llm fetchEmbedding* for upstream-test compatibility.
cp "${repo}/scripts/patches/agent-embeddingsCache.ts" "${dst}/agent/embeddingsCache.ts"
cp "${repo}/scripts/patches/agent-memory.ts" "${dst}/agent/memory.ts"

# Hardcode EMBEDDING_DIMENSION to 1536 (MiniMax embo-01). The schema's
# memoryEmbeddings vector index reads this constant; flipping it
# requires wiping memoryEmbeddings + embeddingsCache first
# (convex/ours/mutations/wipeEmbeddings) since Convex won't migrate a
# dim change while rows exist at the old dim.
#
# Also remove ai-town's "EMBEDDING_DIMENSION must be 768 for Together.ai"
# runtime guard inside getLLMConfig(). We use Together for chat (Llama) but
# MiniMax for embeddings, so the guard's invariant doesn't hold for us
# and it would block every chatCompletion call. (The guard is 3 lines:
# the `if (EMBEDDING_DIMENSION !== TOGETHER_EMBEDDING_DIMENSION) {`,
# the throw, and the closing `}`.)
sed -i.bak -E \
  -e 's/^export const EMBEDDING_DIMENSION: number = OLLAMA_EMBEDDING_DIMENSION;$/export const EMBEDDING_DIMENSION: number = 1536;/' \
  "${dst}/util/llm.ts"
# Strip the dim guard (3 consecutive lines).
perl -i -0pe 's/    if \(EMBEDDING_DIMENSION !== TOGETHER_EMBEDDING_DIMENSION\) \{\n      throw new Error\(.EMBEDDING_DIMENSION must be 768 for Together\.ai.\);\n    \}\n//' "${dst}/util/llm.ts"
# Short-circuit detectMismatchedLLMProvider — it pattern-matches a hardcoded
# provider→dim table and panics on init when our dim (1536, MiniMax) is set
# but OPENAI_API_KEY is absent. Our setup uses DeepSeek + MiniMax via our
# own clients, so the check is wrong for us.
perl -i -pe 's|^(export function detectMismatchedLLMProvider\(\) \{)$|$1\n  return;|' "${dst}/util/llm.ts"

# Suppress ai-town's verbose per-tick / per-event logs that push the
# runStep action past Convex's 256-line log cap (and bury real errors
# under chatter). Each substitution is idempotent — it prefixes a bare
# console.* line with `// `, and lines already starting with `//` are
# skipped by the leading-whitespace anchor.
perl -i -pe 's|^(\s*)(console\.debug\(`Simulated from )|$1// $2|' "${dst}/engine/abstractGame.ts"
perl -i -0pe 's|(\s*)if \(bufferSize > 0\) \{\n\s*console\.debug\(\n\s*`Packed \$\{Object\.entries\(historicalLocations\)\.length\} history buffers in \$\{\(\n\s*bufferSize / 1024\n\s*\)\.toFixed\(2\)\}KiB\.`,\n\s*\);\n\s*\}|$1// (suppressed — see sync-ai-town.sh for why)|' "${dst}/aiTown/game.ts"
# Sweep: comment out every `console.log(` in the three noisiest ai-town
# files. These are all per-event logs (pathfinding failures, agent
# walking, conversation start/leave, accept/reject invite, etc.) that
# fire constantly during normal play.
for f in "${dst}/aiTown/agent.ts" "${dst}/aiTown/conversation.ts" "${dst}/aiTown/player.ts"; do
  perl -i -pe 's|^(\s*)(console\.log\()|$1// $2|' "$f"
done
rm -f "${dst}/util/llm.ts.bak"

# townHooks.ts lives under ours/ on the source side; mirror that.
mkdir -p "${dst}/ours"
cp "${src}/ours/townHooks.ts" "${dst}/ours/townHooks.ts"

# Data assets — referenced by ai-town's runtime via ../../data paths
# that, after sync, resolve to repo root.
cp -r "$data_src" "$data_dst"

echo "sync-ai-town: synced into convex/ (aiTown, agent, engine, util,"
echo "  constants.ts, ours/townHooks.ts) + data/ at repo root."
