#!/usr/bin/env bash
# Exercise scripts/check-no-bare-llm-calls.sh end-to-end:
#   1. clean tree                                 → PASS
#   2. drop an SDK import outside the allowlist   → FAIL
#   3. drop an SDK import inside a test file      → PASS (mocking exemption)
#   4. drop an SDK import inside ai-town-fork/    → PASS (additivity gate
#                                                  already covers it)
#
# The fixtures are written to predictable paths and removed even if the
# script is interrupted (INT / TERM trap).
set -euo pipefail

BAD_FILE="convex/ours/lib/__llmcheck_bad__.ts"
TEST_FILE="convex/tests/__llmcheck_mocktest__.test.ts"
TOWN_FILE="ai-town-fork/__llmcheck_town__.ts"

restore() {
  rm -f "$BAD_FILE" "$TEST_FILE" "$TOWN_FILE"
}
trap restore EXIT INT TERM

# 1. clean tree → PASS
if ! bash scripts/check-no-bare-llm-calls.sh > /dev/null 2>&1; then
  echo "FAIL: clean tree should pass the chokepoint check"
  exit 1
fi

# 2. unauthorized SDK import → FAIL
cat > "$BAD_FILE" <<'EOF'
import Anthropic from '@anthropic-ai/sdk';
export const c = new Anthropic();
EOF
if bash scripts/check-no-bare-llm-calls.sh > /dev/null 2>&1; then
  echo "FAIL: unauthorized @anthropic-ai/sdk import should fail the check"
  exit 1
fi
rm -f "$BAD_FILE"

# 3. SDK import inside a test file → PASS (mocking exemption)
cat > "$TEST_FILE" <<'EOF'
import { describe } from 'vitest';
// vi.mock('@anthropic-ai/sdk') would appear in real tests.
import '@anthropic-ai/sdk';
describe('placeholder', () => {});
EOF
if ! bash scripts/check-no-bare-llm-calls.sh > /dev/null 2>&1; then
  echo "FAIL: SDK import inside a test file should be exempt"
  exit 1
fi
rm -f "$TEST_FILE"

# 4. SDK import inside ai-town-fork/ → PASS (additivity gate covers it)
cat > "$TOWN_FILE" <<'EOF'
// Upstream ai-town might import the SDK; that's policed by the
// Task 2 additivity gate, not this script.
import '@anthropic-ai/sdk';
EOF
if ! bash scripts/check-no-bare-llm-calls.sh > /dev/null 2>&1; then
  echo "FAIL: SDK import inside ai-town-fork/ should be skipped here"
  exit 1
fi
rm -f "$TOWN_FILE"

echo "LLM chokepoint test PASSED"
