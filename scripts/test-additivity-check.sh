#!/usr/bin/env bash
# Exercise scripts/check-ai-town-additivity.sh end-to-end:
#   1. clean state              → PASS
#   2. modified upstream file   → FAIL (MODIFIED)
#   3. restored state           → PASS
#   4. new file outside ours/   → FAIL (UNAUTHORIZED_NEW_FILE)
#   5. new file inside ours/    → PASS (allowed namespace)
#   6. allowlist with header-commented EXEMPT example → parser skips comments
set -euo pipefail

TARGET="ai-town-fork/README.md"
NEW_TOP="ai-town-fork/__bypass_test__.txt"
NEW_OURS_DIR="ai-town-fork/ours"
NEW_OURS="ai-town-fork/ours/__test_allowed__.ts"
ALLOWLIST="ai-town-fork/UPSTREAM_FILES.txt"

if [[ ! -f "$TARGET" ]]; then
  echo "test fixture missing: $TARGET"
  exit 2
fi

BACKUP="/tmp/additivity-test-backup-$$"
ALLOWLIST_BACKUP="/tmp/additivity-allowlist-backup-$$"
cp "$TARGET" "$BACKUP"
cp "$ALLOWLIST" "$ALLOWLIST_BACKUP"

CREATED_OURS_DIR=0

restore() {
  cp "$BACKUP" "$TARGET" 2>/dev/null || true
  cp "$ALLOWLIST_BACKUP" "$ALLOWLIST" 2>/dev/null || true
  rm -f "$BACKUP" "$ALLOWLIST_BACKUP"
  rm -f "$NEW_TOP" "$NEW_OURS"
  if [[ "$CREATED_OURS_DIR" -eq 1 ]]; then
    rmdir "$NEW_OURS_DIR" 2>/dev/null || true
  fi
}
# Cover Ctrl-C (INT) and kill (TERM) in addition to normal EXIT so the
# fixture never gets left in a tampered state.
trap restore EXIT INT TERM

# 1. clean
if ! bash scripts/check-ai-town-additivity.sh > /dev/null 2>&1; then
  echo "FAIL: clean state should pass the check"
  exit 1
fi

# 2. modified
echo "// deliberate test modification" >> "$TARGET"
if bash scripts/check-ai-town-additivity.sh > /dev/null 2>&1; then
  echo "FAIL: modified state should fail the check"
  exit 1
fi

# 3. restored
cp "$BACKUP" "$TARGET"
if ! bash scripts/check-ai-town-additivity.sh > /dev/null 2>&1; then
  echo "FAIL: restored state should pass"
  exit 1
fi

# 4. new file outside ours/ → UNAUTHORIZED_NEW_FILE
: > "$NEW_TOP"
OUT=$(bash scripts/check-ai-town-additivity.sh 2>&1 || true)
if [[ "$OUT" != *"UNAUTHORIZED_NEW_FILE"* ]]; then
  echo "FAIL: new file outside ours/ should fail with UNAUTHORIZED_NEW_FILE"
  echo "$OUT"
  exit 1
fi
rm -f "$NEW_TOP"

# 5. new file inside ours/ → allowed
if [[ ! -d "$NEW_OURS_DIR" ]]; then
  mkdir -p "$NEW_OURS_DIR"
  CREATED_OURS_DIR=1
fi
: > "$NEW_OURS"
if ! bash scripts/check-ai-town-additivity.sh > /dev/null 2>&1; then
  echo "FAIL: new file inside ours/ should pass (allowed namespace)"
  exit 1
fi
rm -f "$NEW_OURS"
if [[ "$CREATED_OURS_DIR" -eq 1 ]]; then
  rmdir "$NEW_OURS_DIR" 2>/dev/null || true
  CREATED_OURS_DIR=0
fi

# 6. parser correctly skips a header-style EXEMPT example line. Append a
# fixture EXEMPT entry pointing at a non-existent path; the check must still
# pass because EXEMPT short-circuits the MODIFIED/MISSING checks for that path,
# and the new line is not a real file so it doesn't trip UNAUTHORIZED_NEW_FILE.
printf '\n./__test_exempt_fixture__.txt   # EXEMPT: parser test fixture\n' >> "$ALLOWLIST"
if ! bash scripts/check-ai-town-additivity.sh > /dev/null 2>&1; then
  echo "FAIL: EXEMPT fixture line should not break the parser"
  exit 1
fi
cp "$ALLOWLIST_BACKUP" "$ALLOWLIST"

echo "additivity test script PASSED"
