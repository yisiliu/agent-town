#!/usr/bin/env bash
# Exercise scripts/check-ai-town-additivity.sh: clean state must PASS,
# tampered state must FAIL, restored state must PASS again.
set -euo pipefail

TARGET="ai-town-fork/README.md"
if [[ ! -f "$TARGET" ]]; then
  echo "test fixture missing: $TARGET"
  exit 2
fi

BACKUP="/tmp/additivity-test-backup-$$"
cp "$TARGET" "$BACKUP"

restore() {
  cp "$BACKUP" "$TARGET"
  rm -f "$BACKUP"
}
trap restore EXIT

if ! bash scripts/check-ai-town-additivity.sh > /dev/null 2>&1; then
  echo "FAIL: clean state should pass the check"
  exit 1
fi

echo "// deliberate test modification" >> "$TARGET"

if bash scripts/check-ai-town-additivity.sh > /dev/null 2>&1; then
  echo "FAIL: modified state should fail the check"
  exit 1
fi

cp "$BACKUP" "$TARGET"

if ! bash scripts/check-ai-town-additivity.sh > /dev/null 2>&1; then
  echo "FAIL: restored state should pass"
  exit 1
fi

echo "additivity test script PASSED"
