#!/usr/bin/env bash
# Symmetric additivity gate for the ai-town fork. Three failure modes:
#   (a) MODIFIED       — an upstream file's SHA differs from UPSTREAM_FILES.lock
#   (b) MISSING        — an upstream file recorded in the lock is gone
#   (c) UNAUTHORIZED_NEW_FILE — a file exists in ai-town-fork/ outside ours/
#                              that is not in UPSTREAM_FILES.txt
#
# Files annotated with `# EXEMPT: <reason>` in UPSTREAM_FILES.txt skip the
# MODIFIED check (pre-authorized drift, e.g. a tick-gate patch).
set -euo pipefail

LOCK="ai-town-fork/UPSTREAM_FILES.lock"
ALLOWLIST="ai-town-fork/UPSTREAM_FILES.txt"

if [[ ! -f "$LOCK" || ! -f "$ALLOWLIST" ]]; then
  echo "missing lock or allowlist; run from repo root"
  exit 2
fi

FAILED=0

# Collect EXEMPT paths and the full allowlist into newline-delimited strings
# (portable to bash 3.2, the default on macOS, which lacks associative arrays).
EXEMPT_LIST=""
ALLOWED_LIST=""
while IFS= read -r line; do
  # Strip comments / blank lines for path extraction
  path="${line%%#*}"
  path="$(echo "$path" | xargs)"
  if [[ -z "$path" ]]; then continue; fi
  ALLOWED_LIST="${ALLOWED_LIST}${path}"$'\n'
  # Anchor on the full marker "# EXEMPT:" — a substring match on "EXEMPT"
  # would wrongly exempt any path that happened to contain that string.
  if [[ "$line" == *"# EXEMPT:"* ]]; then
    EXEMPT_LIST="${EXEMPT_LIST}${path}"$'\n'
  fi
done < "$ALLOWLIST"

is_exempt() {
  case $'\n'"$EXEMPT_LIST" in
    *$'\n'"$1"$'\n'*) return 0 ;;
    *) return 1 ;;
  esac
}

is_allowed() {
  case $'\n'"$ALLOWED_LIST" in
    *$'\n'"$1"$'\n'*) return 0 ;;
    *) return 1 ;;
  esac
}

# (a) + (b): per-lock-entry MODIFIED / MISSING checks
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

# (c): UNAUTHORIZED_NEW_FILE — anything in ai-town-fork/ outside ours/ that
# isn't on the allowlist. Excludes our own metadata, generated artifacts, and
# vendored dependencies.
while IFS= read -r found; do
  # Normalize to the "./<path>" form used in UPSTREAM_FILES.txt
  rel="./${found#ai-town-fork/}"
  if ! is_allowed "$rel"; then
    echo "UNAUTHORIZED_NEW_FILE: $rel"
    echo "  add to $ALLOWLIST (and regen the lock) or place under ai-town-fork/ours/"
    FAILED=1
  fi
done < <(find ai-town-fork -type f \
  -not -path 'ai-town-fork/node_modules/*' \
  -not -path 'ai-town-fork/ours/*' \
  -not -path 'ai-town-fork/convex/ours/*' \
  -not -name 'UPSTREAM_VERSION.txt' \
  -not -name 'UPSTREAM_FILES.txt' \
  -not -name 'UPSTREAM_FILES.lock')

if [[ "$FAILED" -ne 0 ]]; then
  echo "ai-town additivity check FAILED"
  echo "If a modification is intentional, add a '# EXEMPT: <reason>' annotation in $ALLOWLIST"
  echo "If a new file came from an upstream rebase, run scripts/regen-upstream-lock.sh"
  exit 1
fi
echo "ai-town additivity check PASSED"
