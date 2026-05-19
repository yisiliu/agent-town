# Running agent-town locally

Status: the upload flow runs end-to-end after the Tier 1 + Tier 2 setup
below. The full town simulation (ai-town tick loop, twin-as-player
mapping, games, instructor UI) is Tier 3 — covered by Tasks 15+ of the
plan and not built yet.

If you only care about smoke-testing the upload pipeline against the
fixtures, do **§1–§4** and **§6**. Everything else is for going beyond
that.

---

## 1. Prerequisites

```bash
bun --version       # >= 1.3
node --version      # >= 20
git --version
```

Accounts you'll need:

- **Convex** — free tier is fine for dev. Sign up at https://convex.dev.
- **Anthropic** — production-grade key. The frontier-tier llmRouter
  hits Claude Sonnet 4.6.
- **Together** — for Llama Guard 3 prompt-injection scans. Without
  this key, every upload fails-closed (see §4).
- **RunPod** (optional) — for the local tier of llmRouter (idle
  thoughts, move decisions). Without it twins silently skip ambient
  ticks (Task 12 silent-twin fallback).

Then clone and install:

If you don't already have the repo checked out:

```bash
git clone <your-agent-town-fork-url>   # paste your fork's URL here
cd agent-town
bun install
```

---

## 2. Convex project setup (one-time)

The committed `convex/_generated/` is a stub so `convex-test` can run
without a real deployment. The first run of `convex dev` overwrites it
with codegen against the live deployment.

```bash
# From repo root. Opens a browser for login on first run, prompts for
# a project name, writes <repo>/.env.local with CONVEX_DEPLOYMENT=...,
# and rewrites convex/_generated/ with real codegen. Keeps running and
# watches convex/ for changes — leave it in a terminal.
bunx convex dev
```

Two manual follow-ups after `convex dev` first reports "Convex
functions ready!":

1. **Tell the shell where Convex lives.** `convex dev` writes the
   deployment identifier to `<repo>/.env.local` but does NOT write
   `NEXT_PUBLIC_CONVEX_URL`. The shell reads that var via Next.js,
   which only sees `shell/.env.local`. Copy the URL `convex dev`
   printed (or look it up at https://dashboard.convex.dev), then:

   ```bash
   echo "NEXT_PUBLIC_CONVEX_URL=https://<your-deployment>.convex.cloud" \
     > shell/.env.local
   ```

2. **Decide on the regenerated `convex/_generated/`.** It now matches
   your real deployment; old stubs are gone. Recommendation: commit
   it. It unblocks typed function refs in integration tests and the
   shell. If you want to keep the stubs for any reason, run
   `git checkout convex/_generated/` and regenerate later with
   `bunx convex codegen`.

Sanity check the deployment is reachable before moving on:

```bash
bunx convex env list   # should print an empty list (no errors)
```

---

## 3. Environment variables

`bunx convex env set` writes to the dev deployment by default (use
`--prod` once a prod deployment exists — see §9). Open a second
terminal so `convex dev` keeps watching in the first.

```bash
bunx convex env set ANTHROPIC_API_KEY sk-ant-...
bunx convex env set TOGETHER_API_KEY ...

# Required if you plan to register an instructor with WebAuthn (Task 7).
# AGENT_TOWN_RP_ID is host only (no scheme, no port). AGENT_TOWN_ORIGIN
# is the full origin the browser sees — if Next falls back to port 3001
# because 3000 is taken, change ORIGIN to match or registration breaks.
bunx convex env set AGENT_TOWN_RP_ID localhost
bunx convex env set AGENT_TOWN_ORIGIN http://localhost:3000

# RunPod is optional — see §5. Only set these once you have an endpoint.
```

Confirm shell-side env is in place (you wrote this in §2 step 1):

```bash
cat shell/.env.local
# → NEXT_PUBLIC_CONVEX_URL=https://<your-deployment>.convex.cloud
```

---

## 4. What each key actually gates

The two scans behave differently when their respective key is missing,
because they have different fallback semantics:

- **`promptInjectionScan` fail-closes on every error**, including
  missing `TOGETHER_API_KEY`. With no Together key, every upload is
  rejected with `"classifier error — fail-closed per spec §4.9"`.
  Workable options:
  - **Get a Together dev key** (~$5 covers months; Llama Guard 3 8B
    is ~$0.20/M tokens — a card scan is fractions of a cent).
  - **Stub the scan locally**: edit
    `convex/ours/actions/promptInjectionScan.ts` to return
    `{decision: 'pass', reasons: []}`. **Never commit this — verify
    with `git diff` before pushing.**

- **`piiScan` short-circuits in regex when PII is present**, so the
  LLM is only called on cards that pass the regex layer. That means:
  - `with-pii.md` (regex hits phone + email + address) → blocked
    before any Anthropic call. Works without `ANTHROPIC_API_KEY`.
  - `clean-zh.md` (no regex hits) → falls through to the LLM
    classifier, which needs `ANTHROPIC_API_KEY` set. Without the key,
    the classifier throws and the result is `manual_review` (not
    block, not pass).

The Anthropic SDK reads `ANTHROPIC_API_KEY` from env automatically —
nothing in our code references the variable directly.

---

## 5. RunPod endpoint (optional, for local tier)

Skip this section if you're OK with twins being silent during ambient
ticks. The frontier-tier conversation path doesn't need RunPod.

```bash
# 1. Create a Serverless endpoint at https://runpod.io/console/serverless.
# 2. Deploy a vLLM template with model Qwen/Qwen3-7B-Instruct (or similar).
# 3. Endpoint must accept POST /runsync with body:
#      {
#        "input": {
#          "model": "qwen3-7b",
#          "system": "<persona prompt>",
#          "messages": [{"role": "user", "content": "..."}],
#          "max_tokens": 80,
#          "temperature": 0.7
#        }
#      }
#    and return: { "status": "COMPLETED",
#                  "output": { "choices": [{"message": {"content": "..."}}],
#                              "usage": { "prompt_tokens", "completion_tokens" } } }
# 4. Copy the endpoint ID and an API key.

bunx convex env set RUNPOD_ENDPOINT_ID <id>
bunx convex env set RUNPOD_API_KEY <key>
```

If your template uses a different envelope (e.g., raw OpenAI without
the `input` wrapper), edit `convex/ours/lib/runpodClient.ts`'s `body`
and `parseRunpodReply` to match.

---

## 6. Configure scheduled class sessions

`config/sessions.json` ships with an empty `sessions` array (plus a
`_comment` key the cron ignores). Until you populate it, the
sessionWindow cron computes `state='frozen'` every tick — the upload
flow still works, but the (currently-non-existent) town never ticks.

```json
{
  "_comment": "Scheduled class sessions in absolute UTC.",
  "sessions": [
    {
      "startUtc": "2026-05-21T02:00:00.000Z",
      "endUtc":   "2026-05-21T03:30:00.000Z"
    }
  ]
}
```

The file is bundled into the Convex deployment, so edits require
`convex dev` (or `convex deploy` for prod) to pick them up. `convex
dev` running in §2 will hot-reload automatically. For manual override
during dev, an instructor with a valid session token can call
`ours/mutations/resumeWorld:default` — see §8.

---

## 7. Run it

Two terminals (the `convex dev` one should already be running from
§2 — leave it):

```bash
# Terminal 1 — Convex backend (watches convex/ and redeploys functions)
bunx convex dev
# Wait for: "Convex functions ready!" before opening the browser.

# Terminal 2 — Next.js shell
cd shell && bun dev
# Wait for: "✓ Ready in <Nms>" and "Local: http://localhost:3000".
```

Open http://localhost:3000/upload. If the page renders but the
dropzone is unresponsive, check that `shell/.env.local` has the
Convex URL (§2 step 1) — the React client silently no-ops with an
empty URL.

---

## 8. Smoke test the upload flow

Build a zip from each fixture:

```bash
cd fixtures/cards
zip /tmp/clean.zip clean-zh.md
zip /tmp/pii.zip   with-pii.md
zip /tmp/inj.zip   with-injection.md
zip /tmp/bad.zip   invalid-missing-section.md
cd -
```

Drag each into the `/upload` page. Expected:

| Zip | Expected UI |
|---|---|
| `clean.zip` | "Uploading + scanning…" → green box titled "Twin created. Save these three codes…" with three 6-digit codes + "I've saved these securely" button |
| `pii.zip` | "Uploading + scanning…" → red "Twin rejected" box listing PII reasons (phone + email + address) |
| `inj.zip` | "Uploading + scanning…" → red "Twin rejected" box with prompt-injection reason |
| `bad.zip` | Immediate red "Upload failed:" line listing missing sections — never reaches scan stage |

Or drive it from the command line via `bunx convex run`. The path
syntax is `<module-path>:<exported-name>`; the default export uses
`:default`.

```bash
# Base64 the zip, stripping newline wraps that macOS adds:
base64 -i /tmp/clean.zip | tr -d '\n' > /tmp/clean.b64

# Call the action:
bunx convex run ours/actions/uploadTwin:default \
  "{\"zipBase64\": \"$(cat /tmp/clean.b64)\"}"
# → { uploadSessionToken: "...", twinId: "..." }

# Scans run via ctx.scheduler.runAfter(0, ...) — typically 1-30s
# depending on Anthropic + Together latency. Poll:
bunx convex run ours/queries/uploadResultByToken:byToken \
  '{"uploadSessionToken": "<token from above>"}'
# state: 'pending' → still scanning. Retry every few seconds.
# state: 'active'  → done; codes in the response.
# state: 'rejected' → done; errors in the response.
```

For instructor override during dev (skip WebAuthn registration by
manually seeding a session row via the Convex dashboard, then):

```bash
bunx convex run ours/mutations/resumeWorld:default \
  '{"instructorSessionToken": "<your-test-token>"}'
```

(A proper instructor god-mode UI lands with Tasks 26+.)

---

## 9. Production deploy

Convex's prod story is "different deployment, different deploy key"
— there's no `--prod` flag on `convex deploy`. The deployment is
selected by `CONVEX_DEPLOYMENT` / `CONVEX_DEPLOY_KEY` env vars at
deploy time.

```bash
# 1. Create a production deployment in the Convex dashboard
#    (Project → Settings → Production). Copy its deploy key.

# 2. Test the prod deployment from a non-prod context before
#    committing to it:
CONVEX_DEPLOY_KEY=<prod-key> bunx convex env set --prod ANTHROPIC_API_KEY ...
CONVEX_DEPLOY_KEY=<prod-key> bunx convex env set --prod TOGETHER_API_KEY ...
CONVEX_DEPLOY_KEY=<prod-key> bunx convex env set --prod AGENT_TOWN_RP_ID example.com
CONVEX_DEPLOY_KEY=<prod-key> bunx convex env set --prod AGENT_TOWN_ORIGIN https://example.com
# ...and RunPod if you have it.

# 3. Verify all prod env vars are set BEFORE pushing code:
CONVEX_DEPLOY_KEY=<prod-key> bunx convex env list --prod

# 4. Deploy code to prod:
CONVEX_DEPLOY_KEY=<prod-key> bunx convex deploy

# 5. Shell to Vercel
cd shell
vercel link
vercel env add NEXT_PUBLIC_CONVEX_URL production
# Paste the prod Convex URL when prompted.

# Test a preview deployment against prod Convex first:
vercel
# Visit the preview URL, smoke-test §8 against it.

# Then promote:
vercel --prod
```

WebAuthn quirks for prod:

- `AGENT_TOWN_RP_ID` is the **eTLD+1 only** (e.g., `example.com`, no
  scheme, no path, no port).
- `AGENT_TOWN_ORIGIN` is the **full origin with scheme** (e.g.,
  `https://example.com`).
- These must match what the browser sees, including subdomain.
  A mismatch silently breaks registration.

---

## 10. Known gaps from the current state

What works after this setup:

- ✅ Twin upload (card.md validation, PII + injection scans, code
  issuance).
- ✅ Instructor WebAuthn registration (Task 7) — but no UI; call the
  mutations directly.
- ✅ Class-hours scheduling (Task 13) — cron flips worldState based
  on `config/sessions.json`.
- ✅ Per-twin daily $0.50 kill-switch — fires if a twin's frontier
  spend exceeds the cap.

What does **not** work yet:

- ❌ The actual 2D town. ai-town's runtime code lives in
  `ai-town-fork/convex/`, but `convex.json` only deploys `convex/`.
  Schema composition (the `'ai-town/upstream'` alias) is wired for
  tsc + vitest but not for Convex deploy. Task 14's tick gate
  compiles but never runs.
- ❌ **Sharp on Convex deploy is unverified.** Sharp is a native
  module; Convex's Node action runtime bundles via esbuild. If
  `convex deploy` errors with "Cannot find module 'sharp'" or
  similar, the workaround is to remove the avatar re-encoding step
  from `convex/ours/actions/uploadTwin.ts` and skip avatars in v1.
  The fixtures have no avatars, so the smoke test in §8 doesn't
  exercise this path; you'll only hit it with real student uploads.
- ❌ Twin → player mapping (Task 15).
- ❌ Noticeboard, digests, retraction UI, audit log, Decrypto game,
  instructor dashboard (Tasks 16–28).
- ❌ Data export / delete flow (Tasks 30–31).

To resolve the deploy-composition question, the realistic options:

1. **Merge ai-town-fork's runtime files into root `convex/`** at
   build time. Add a `scripts/sync-ai-town.sh` that copies
   `ai-town-fork/convex/aiTown/`, `engine/`, `agent/`, etc., into
   `convex/` before `convex deploy`. Slightly hacky but works with
   stock Convex.
2. **Use a single `convex/` directory from the start** and apply
   ai-town as a patch series instead of a fork. Bigger refactor;
   loses the additivity gate's auditability.
3. **Two Convex deployments** — one for our shell-facing API, one
   for ai-town. Cross-deployment talk via hand-rolled HTTP actions
   (Convex has no first-class cross-deployment queries). Highest
   complexity.

Option 1 is the path of least resistance. Worth surfacing before
Task 15.
