#!/usr/bin/env bash
# Spec §5.1 chokepoint enforcement. Raw access to DeepSeek's API may
# only originate from convex/ours/lib/deepseekClient.ts. Anywhere else,
# including ai-town-fork's additive surface and shell/, a hit on the
# DeepSeek API URL must fail CI.
#
# Tests under convex/tests/ and shell/tests/ are exempt — mocking deps
# at the routeLLMCall boundary is legitimate.
set -euo pipefail

ALLOWED_FILES=(
  "convex/ours/lib/deepseekClient.ts"
)

# Match real API endpoint hits — covers fetch(...) and any URL string
# literal. Deliberately narrow: bare uses of the word "deepseek" in
# comments / identifiers don't trip the gate, only the actual host.
PATTERN='api\.deepseek\.com'

FAILED=0
while IFS=: read -r file _rest; do
  rel="${file#./}"
  case " ${ALLOWED_FILES[*]} " in
    *" $rel "*) continue ;;
  esac
  # Skip test files — mocking the dep there is legitimate.
  case "$rel" in
    *.test.ts|*.test.tsx) continue ;;
    convex/tests/*|shell/tests/*) continue ;;
  esac
  # Skip ai-town-fork upstream (covered by Task 2 additivity gate).
  case "$rel" in
    ai-town-fork/*) continue ;;
  esac
  echo "BARE_LLM_CALL: $rel"
  echo "  hits the DeepSeek API directly. Route through"
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
