#!/usr/bin/env bash
# Verify that every upstream ai-town file matches the SHA recorded in
# ai-town-fork/UPSTREAM_FILES.lock. Files annotated with `# EXEMPT: <reason>`
# in ai-town-fork/UPSTREAM_FILES.txt are skipped (pre-authorized exceptions).
set -euo pipefail

LOCK="ai-town-fork/UPSTREAM_FILES.lock"
ALLOWLIST="ai-town-fork/UPSTREAM_FILES.txt"

if [[ ! -f "$LOCK" || ! -f "$ALLOWLIST" ]]; then
  echo "missing lock or allowlist; run from repo root"
  exit 2
fi

FAILED=0
# Collect EXEMPT paths into a newline-delimited string (portable to bash 3.2,
# the default on macOS, which lacks associative arrays).
EXEMPT_LIST=""
while IFS= read -r line; do
  # Split on first '#'; trim whitespace from the path portion.
  path="${line%%#*}"
  path="$(echo "$path" | xargs)"
  if [[ -z "$path" ]]; then continue; fi
  if [[ "$line" == *"EXEMPT"* ]]; then
    EXEMPT_LIST="${EXEMPT_LIST}${path}"$'\n'
  fi
done < "$ALLOWLIST"

is_exempt() {
  case $'\n'"$EXEMPT_LIST" in
    *$'\n'"$1"$'\n'*) return 0 ;;
    *) return 1 ;;
  esac
}

while IFS=$'\t' read -r path expected_sha; do
  if is_exempt "$path"; then
    continue
  fi
  full="ai-town-fork/${path#./}"
  if [[ ! -f "$full" ]]; then
    echo "MISSING: $path"
    FAILED=1
    continue
  fi
  actual_sha=$(git hash-object "$full")
  if [[ "$actual_sha" != "$expected_sha" ]]; then
    echo "MODIFIED: $path"
    echo "  expected: $expected_sha"
    echo "  actual:   $actual_sha"
    FAILED=1
  fi
done < "$LOCK"

if [[ "$FAILED" -ne 0 ]]; then
  echo "ai-town additivity check FAILED"
  echo "If the modification is intentional, add an EXEMPT annotation in $ALLOWLIST"
  exit 1
fi
echo "ai-town additivity check PASSED"
