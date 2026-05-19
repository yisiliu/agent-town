#!/usr/bin/env bash
# Exercise scripts/check-no-bare-llm-calls.sh end-to-end:
#   1. clean tree                                 → PASS
#   2. drop a DeepSeek API hit outside the allowlist → FAIL
#   3. drop a DeepSeek API hit inside a test file → PASS (mocking exemption)
#   4. drop a DeepSeek API hit inside ai-town-fork/ → PASS (additivity gate
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

# 2. unauthorized DeepSeek hit → FAIL
cat > "$BAD_FILE" <<'EOF'
export async function rogue() {
  return fetch('https://api.deepseek.com/v1/chat/completions');
}
EOF
if bash scripts/check-no-bare-llm-calls.sh > /dev/null 2>&1; then
  echo "FAIL: unauthorized api.deepseek.com hit should fail the check"
  exit 1
fi
rm -f "$BAD_FILE"

# 3. DeepSeek hit inside a test file → PASS (mocking exemption)
cat > "$TEST_FILE" <<'EOF'
import { describe } from 'vitest';
// A test fixture that simulates a deepseek URL — legitimate in tests.
const url = 'https://api.deepseek.com/v1/chat/completions';
describe('placeholder', () => {});
EOF
if ! bash scripts/check-no-bare-llm-calls.sh > /dev/null 2>&1; then
  echo "FAIL: DeepSeek URL inside a test file should be exempt"
  exit 1
fi
rm -f "$TEST_FILE"

# 4. DeepSeek hit inside ai-town-fork/ → PASS (additivity gate covers it)
cat > "$TOWN_FILE" <<'EOF'
// Upstream ai-town code; policed by the Task 2 additivity gate, not
// this script.
const url = 'https://api.deepseek.com/v1/chat/completions';
EOF
if ! bash scripts/check-no-bare-llm-calls.sh > /dev/null 2>&1; then
  echo "FAIL: DeepSeek URL inside ai-town-fork/ should be skipped here"
  exit 1
fi
rm -f "$TOWN_FILE"

echo "LLM chokepoint test PASSED"
