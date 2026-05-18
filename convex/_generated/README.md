# _generated

These stubs exist so `convex-test` can locate the modules root. They are
intentionally minimal — Convex CLI codegen will overwrite them at the
first `convex dev` (Task 38). Until then, they are placeholders the
runtime never actually executes via the typed `api` namespace; tests
use `t.run(ctx => ...)` which talks to the ctx.db directly.
