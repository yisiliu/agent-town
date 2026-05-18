#!/usr/bin/env bash
# Spec §5.1 chokepoint enforcement. The Anthropic SDK may only be imported
# from convex/ours/lib/anthropicClient.ts. Anywhere else, including ai-town-
# fork's additive surface and shell/, the import must fail CI.
#
# Tests under convex/tests/ and shell/tests/ are exempt — mocking the SDK
# via vi.mock('@anthropic-ai/sdk') counts as a string match but doesn't
# actually issue any calls.
set -euo pipefail

ALLOWED_FILES=(
  "convex/ours/lib/anthropicClient.ts"
)

# Match real import / require sites for the Anthropic SDK — covers ESM and
# CJS. Deliberately narrow: bare uses of the word "anthropic" (e.g. in
# comments, in identifier names like anthropicClient, or in docstrings)
# don't trip the gate.
PATTERN='@anthropic-ai/sdk'

FAILED=0
while IFS=: read -r file _rest; do
  rel="${file#./}"
  case " ${ALLOWED_FILES[*]} " in
    *" $rel "*) continue ;;
  esac
  # Skip test files — mocking the SDK there is legitimate.
  case "$rel" in
    *.test.ts|*.test.tsx) continue ;;
    convex/tests/*|shell/tests/*) continue ;;
  esac
  # Skip ai-town-fork upstream (covered by Task 2 additivity gate).
  case "$rel" in
    ai-town-fork/*) continue ;;
  esac
  echo "BARE_LLM_CALL: $rel"
  echo "  imports the Anthropic SDK directly. Route through"
  echo "  convex/ours/actions/llmRouter (spec §5.1)."
  FAILED=1
done < <(grep -rEln "$PATTERN" \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude-dir=_generated \
  convex shell 2>/dev/null || true)

if [[ "$FAILED" -ne 0 ]]; then
  echo "LLM chokepoint check FAILED"
  exit 1
fi
echo "LLM chokepoint check PASSED"
