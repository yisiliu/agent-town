#!/usr/bin/env bash
# Regenerate ai-town-fork/UPSTREAM_FILES.{txt,lock} from the current contents
# of ai-town-fork/. Run this after:
#   1. bumping ai-town-fork/UPSTREAM_VERSION.txt to a newer upstream SHA, and
#   2. applying the upstream rebase (file changes / adds / deletes).
#
# Preserves:
#   - The header comment block at the top of UPSTREAM_FILES.txt
#   - Any inline `# EXEMPT: <reason>` annotations on still-present paths
#
# Excludes from both files:
#   - ai-town-fork/node_modules/  (vendored deps)
#   - ai-town-fork/ours/          (our additive code, by convention)
#   - ai-town-fork/convex/ours/   (our additive convex code)
#   - UPSTREAM_VERSION.txt, UPSTREAM_FILES.txt, UPSTREAM_FILES.lock (our metadata)
#
# NOTE: convex/_generated/ IS tracked (matches existing lock behavior). If
# upstream regenerates these on a different machine they'll trip MODIFIED;
# add an EXEMPT line per generated file if that becomes a problem.
set -euo pipefail

cd ai-town-fork

TXT=UPSTREAM_FILES.txt
LOCK=UPSTREAM_FILES.lock

# Preserve header comments (contiguous # block at top of file) and EXEMPT lines
EXISTING_HEADER=""
EXEMPT_LINES=""
if [[ -f "$TXT" ]]; then
  # Header = contiguous run of comment / blank lines at the top of the file.
  EXISTING_HEADER=$(awk '/^#/ || /^[[:space:]]*$/ {print; next} {exit}' "$TXT")
  EXEMPT_LINES=$(grep -F '# EXEMPT:' "$TXT" || true)
fi

# Collect tracked upstream paths
PATHS=$(find . -type f \
  -not -path './node_modules/*' \
  -not -path './ours/*' \
  -not -path './convex/ours/*' \
  -not -name 'UPSTREAM_VERSION.txt' \
  -not -name 'UPSTREAM_FILES.txt' \
  -not -name 'UPSTREAM_FILES.lock' \
  | sort)

# Write allowlist: header (if any), then each path — substituting in the
# matching EXEMPT line when one exists for that path.
{
  if [[ -n "$EXISTING_HEADER" ]]; then
    # Echo header, then ensure exactly one blank line before the path list.
    # Command substitution stripped trailing newlines, so we add one.
    echo "$EXISTING_HEADER"
    echo
  fi
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    exempt_match=""
    if [[ -n "$EXEMPT_LINES" ]]; then
      # Match lines whose path portion (before #) equals $p exactly
      while IFS= read -r el; do
        epath="${el%%#*}"
        epath="$(echo "$epath" | xargs)"
        if [[ "$epath" == "$p" ]]; then
          exempt_match="$el"
          break
        fi
      done <<< "$EXEMPT_LINES"
    fi
    if [[ -n "$exempt_match" ]]; then
      echo "$exempt_match"
    else
      echo "$p"
    fi
  done <<< "$PATHS"
} > "$TXT"

# Write lock: TAB-delimited <path><TAB><git-hash>
: > "$LOCK"
while IFS= read -r p; do
  [[ -z "$p" ]] && continue
  sha=$(git hash-object "$p")
  printf '%s\t%s\n' "$p" "$sha" >> "$LOCK"
done <<< "$PATHS"

count=$(wc -l < "$LOCK" | tr -d ' ')
echo "regenerated $TXT and $LOCK ($count files)"
