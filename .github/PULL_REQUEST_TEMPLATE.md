<!--
Thanks for contributing! A few quick checks before you hit Create PR.

If your AI coding assistant drafted this PR, that's encouraged — but
please skim it yourself before submitting. The reviewer will be doing
the same.
-->

## What this PR does

<!-- 1–3 sentences. What changed, why. -->

## How to verify

<!--
The exact commands/steps a reviewer should run to see this work. Be
specific — "click around" doesn't count. Example:
  1. `cd shell && bun dev`
  2. Open http://localhost:3000/upload
  3. Drop `fixtures/cards/clean-zh.md` zip
  4. Expect green "Twin created" box
-->

## Checklist

- [ ] I read `AGENTS.md` and followed the relevant section for the kind of change I made
- [ ] I ran the existing tests (`bun test`) and they still pass
- [ ] If I touched code in `convex/aiTown/`, `convex/engine/`, `ai-town-fork/convex/aiTown/`, or `ai-town-fork/convex/engine/`, I added an `# EXEMPT: <reason>` annotation in `ai-town-fork/UPSTREAM_FILES.txt`
- [ ] If I added a new file outside `convex/ours/` or `ai-town-fork/src/ours/`, I either justified it in the description or moved it under `ours/`
- [ ] I did NOT commit any `.env*`, deploy keys, real student data, or production deployment URLs
- [ ] No destructive operations in CI (no force-push, no `reset --hard`, no `--no-verify`)

## Related issues / discussion

<!-- Link issues, RFCs, or prior PRs. Skip if none. -->
