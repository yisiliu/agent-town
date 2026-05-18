# agent-town

Monorepo for the agent-town platform: a forked ai-town simulation embedded in a Next.js shell with a shared Convex backend. See `../vibe_coding/docs/superpowers/specs/2026-05-18-distilled-agent-town-design.md` for the spec and `../vibe_coding/docs/superpowers/plans/2026-05-18-agent-town-platform.md` for the implementation plan.

> The spec and plan live in the sibling `vibe_coding` repo; clone that alongside this one.

## Workspaces

- `shell/` — Next.js front-end shell (Task 2)
- `ai-town-fork/` — forked Vite/React ai-town simulation (Task 2)
- `convex/` — shared Convex backend; schema and deploy land in Task 3

## TODO

- Convex deployment requires `bunx convex dev --once --configure new` with login. Deferred to Task 3.
