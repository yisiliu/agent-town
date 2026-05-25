# Werewolf: Seating-Order Correctness + Code-as-Rules Prompt — Design Spec

**Date:** 2026-05-25
**Status:** Approved (spec-review v2 — review findings folded in)
**Scope:** `convex/ours/interactions/werewolf/{rules,state,prompts}.ts`, `convex/ours/actions/interactionTakeTurn.ts`, `convex/tests/werewolf-rules.test.ts`. Backend / agent-facing only. UI visualization is a separate sub-project (B).

## Goal

Fix the werewolf day-discussion so it follows a fixed round-table seat order with the sheriff speaking last (归票), make all vote-tally turns silent, convey the rules to agents as a pseudocode digest instead of prose, and teach agents that speaking position is strategic.

## Background / Problem

Observed in a live 12-player game (interaction `mn75rhbb…`, 120 turns):

- The sheriff (警长) spoke **mid-rotation** (≈4th of 11) instead of last. Root cause: `computeSpeechOrder()` (rules.ts:224) anchors the day-speak loop on **seat 0** (rules.ts:1169) for the 平安夜/双死 case rather than on the sheriff's seat, and a **separate** `sheriff-pull-vote` (归票) phase fires after `day-speak` — so the sheriff effectively speaks twice and the rotation slot isn't last.
- **Vote turns produce public 发言.** `day-vote` emits `kind:'vote'` with `visibility:'public'` (rules.ts:481), and the vote prompt explicitly requests `"say":"<one sentence justification>"` (prompts.ts:750) — so voting becomes another speech round.
- Rules are conveyed to the LLM as long **prose** in `buildSystemPrompt` — verbose and less precise than the actual state machine.
- Agents show no awareness that **speaking order** (who speaks first vs last) is itself strategic.

## Decisions (locked with product owner)

1. **Always anchor day speech on the sheriff** (警左/警右), skip dead. **Drop the 死左/死右 victim-anchor.** Seat order is fixed from game start; e.g. sheriff at seat 4, 警左 → `3-2-1-0-11-10-9-8-7-6-5-4` (sheriff last by construction).
2. **Sheriff speaks once, last** — their single speech is the 归票. No separate extra turn.
3. **One speech per player per discussion round** — applies to `day-speak` only. PK re-speech rounds, 自爆, 遗言, 猎人开枪 are **kept** as-is (京城大师赛 intact).
4. **Rules → pseudocode digest** in the system prompt (strategy stays prose).

### Decisions resolved during spec review (owner may veto)

- **D1 — Silent voting covers election votes too.** `sheriff-vote` / `sheriff-pk-vote` go silent along with `day-vote` / `day-pk-vote`, per the general rule "投票时不发言，直接投票，最多内心戏" (candidates already spoke in 警上发言).
- **D2 — Vote target stays public; only the speech is removed.** A vote turn records its `target` (visible at resolve + via focus-hints, as today) but emits **no public say-text**; `thinking` stays private. "Silent" = no 发言, not a secret ballot. (Matches "直接投票".)
- **D3 — Wolves keep 自爆 on every turn they have it today, including the sheriff's 归票 turn.** Since 自爆 is kept intact, the self-explode allow-list gains `sheriff-pull-vote`; vote turns keep the `self_explode` action option even though their `say` is dropped.
- **D4 — Pseudocode digest = flow + the acting player's own affordances + win conditions only.** It must NOT expose engine resolution internals a player can't observe (e.g. `killed = pendingWolfKill && !(guarded XOR saved)`, guard/witch cross-effects). A villager's prompt shows villager-observable flow; role abilities appear in that role's prompt.

## Design

### A1 — Seat-order logic + silent voting

**A1a. Speech order always sheriff-anchored** (`rules.ts`, `prompts.ts`)
- In the `day-direction` apply handler (rules.ts:1163-1186): set `anchorSeat = (s.sheriff && s.alive.includes(s.sheriff)) ? s.participants.indexOf(s.sheriff) : 0`. **Remove** the `oneDied` victim-anchor branch (rules.ts:1166-1172). The alive guard is load-bearing — `indexOf` of a dead/undefined sheriff returns −1 and silently shifts the whole order; keep the seat-0 fallback for the no-sheriff path.
- `direction` still comes from the sheriff's `day-direction` decision; `left` → step −1 (descending = 警左), `right` → step +1 (ascending = 警右) (rules.ts:222-223, 231).
- `computeSpeechOrder(s, anchorSeat, direction)` loops `k=1..n` from the anchor, so element `k=n` lands back on the anchor → **sheriff last** for both directions, dead skipped. The function body needs **no change**, only the anchor passed to it.
- **Rewrite the agent-facing day-direction prompt** (prompts.ts:691-692): replace the `死左/死右 (从死者…起)` wording with `警左/警右 (从警长左/右起)` for **both** the death and no-death cases — otherwise agents are told the dropped convention while the engine anchors on the sheriff.
- **Update `focusHints` rule (3)** (prompts.ts:325-336): the "你紧挨着昨晚出局的玩家" corpse-adjacency hint is premised on 死左/死右 and is now stale; remove it or fold its intent into A3's positional guidance.
- **No-sheriff games:** keep the seat-0 / engine-direction fallback (rules.ts:437-440 planNextTurn already guards `!s.sheriff || !alive`). A no-sheriff day has **no 归票** (see A1b).

**A1b. Sheriff 归票 is the last day-speak turn; remove the *phase*, keep the *kind*** (`rules.ts`, `state.ts`, `prompts.ts`)
- Remove `'sheriff-pull-vote'` from the **`WerewolfPhase` union** (state.ts:43, +doc 40-42), delete its `planNextTurn` branch (rules.ts:428-434) and apply branch (rules.ts:1155-1161), and the `day-speak → sheriff-pull-vote` transition (rules.ts:1199-1200).
- **Keep the `kind: 'sheriff-pull-vote'`** (it is a turn *kind*, a different namespace from the *phase*). In `day-speak` `planNextTurn` (rules.ts:467-475): when the resolved actor **identity equals `s.sheriff`** (not "last position" — on a no-sheriff day the last entry is just seat-0's player and must stay kind `speak`), return `kind:'sheriff-pull-vote'`; else `kind:'speak'`. Use the same skip-dead-adjusted actor index the loop computes.
- In `day-speak` apply (rules.ts:1188-1207): accept `'sheriff-pull-vote'` alongside `'speak'`/`'abstain'`; when the cursor passes the last alive entry → go **directly to `day-vote`**.
- **Fix the 归票 user-prompt guard** (prompts.ts:580): currently `if (phase === 'sheriff-pull-vote' && kind === 'sheriff-pull-vote')` — after the phase is gone this never matches. Change to key on **kind** (e.g. `kind === 'sheriff-pull-vote'`), so the 归票 prompt fires during `day-speak`. The `parseTurnText` branch (prompts.ts:911) is already kind-only — **leave it**.
- **Self-explode on 归票 (D3):** add `'sheriff-pull-vote'` to the self-explode allow-list (prompts.ts:878) so a wolf-sheriff can still 自爆 on their 归票 turn. (`applyTurn`'s self-explode branch at rules.ts:691 is phase-agnostic; the upstream kind-rewrite in interactionTakeTurn.ts:192 already routes it.)
- **State-field discipline:** `clone()` is rules.ts:34-77; audit it + `initialState` + night-reset + self-explode reset. Note: `sheriff-pull-vote` carried **no dedicated state field**, so no field surgery is expected — the risk is stale *phase-string* references, covered above.

**A1c. Silent voting** (`prompts.ts`, `interactionTakeTurn.ts`)
- Applies to `day-vote`, `day-pk-vote`, and (per D1) `sheriff-vote`, `sheriff-pk-vote`. PK **speech** rounds (`sheriff-pk-speech`, `day-pk-speech`) stay public — unchanged.
- **Prompt:** drop the `"say"` field from the vote prompts (day-vote prompts.ts:750, sheriff-vote :577, day-pk-vote :819, sheriff-pk-vote) — request `{thinking, action.target}` only. **Keep** the `self_explode` action option for wolves (D3).
- **Enforcement (deterministic, not prompt-only):** an LLM may volunteer a `say` anyway, so blank the public text at the append site — in `interactionTakeTurn.ts` mirror the existing `sheriff-claim` silence precedent (interactionTakeTurn.ts:186-188 forces `sayField=''`). The blanking guard must match exactly these four `plan.kind` values: **`vote`** (day-vote), **`sheriff-vote`**, **`sheriff-pk-vote`**, **`day-pk-vote`** — and NOT the PK *speech* kinds. (Parsers at prompts.ts:921-945/967-979 may still pass `say` through into `data`; that's harmless because the append site blanks it.) The vote `target` is still recorded into `pendingVotes` (public at resolve + read by focus-hints prompts.ts:343-360, which use state not transcript — no breakage). `thinking` stays private.
- **Visibility (D2):** leave the turn's `visibility` as-is; "silent" is achieved by the empty public text, so the vote action remains observable but no 发言 enters the transcript.

### A2 — Rules as pseudocode digest (`prompts.ts buildSystemPrompt`)

- Replace the prose rule sections with a compact **pseudocode digest** of the game **flow + affordances** (D4):
  - phase order (night 守→狼→女→预 → resolve → [hunter] → [last-words] → day-1 sheriff-claim/vote → day-direction → day-speak in seat order, **sheriff last** → silent day-vote → resolve → next night);
  - win conditions (wolves ≥ non-wolves, or all wolves dead);
  - per-phase: whose turn, what action is available **to the acting role**.
- Do **NOT** surface engine resolution math players can't observe (no `killed = … XOR …`, no guard/witch cross-effects in a generic prompt). Role-specific abilities (witch save/poison, seer check, guard, hunter) appear in that role's prompt only.
- Pseudocode, not raw TypeScript. Keep it shorter than the prose it replaces.

### A3 — Positional strategy (prose, `prompts.ts`)

Add to each agent's strategy guidance:
- Early speakers have little info but set the tone and can 起跳; late speakers see everyone and can 抗推 / 归票 / adjust.
- The sheriff's 归票 (last) is the highest-leverage slot; the 警左/警右 choice is itself a weapon (who you force to speak first/last).
- Agents weigh their own seat and today's direction. (Absorbs the removed corpse-adjacency hint's intent.)

## Testing (TDD) — `convex/tests/werewolf-rules.test.ts`

New / changed:
- `computeSpeechOrder` sheriff-anchored: sheriff@4 + `left` → `[3,2,1,0,11,10,9,8,7,6,5,4]`; `right` → ascending; sheriff always last; dead skipped mid-order; no-sheriff fallback still yields a full order.
- **Rewrite/delete the existing death-anchor tests** (the `死右`/`死左`/exactly-one-death cases at ~rules.test.ts:1521, 1553, 1584-1612) — they assert the removed victim-anchor and **will fail**. The rewritten versions must keep the **sheriff-present-AND-one-death** scenario (the exact condition that exposed the live bug) and now assert the anchor is the **sheriff's seat** / the sheriff speaks **last** — don't drop that regression guard. The 平安夜 (~1614) and no-sheriff fallback (~1482, ~1638) cases stay.
- **New 死左/死右-removal test:** a one-death night anchors on the **sheriff**, not the victim's seat.
- `day-speak` flow: each alive player appears once; the sheriff's turn carries kind `sheriff-pull-vote` and is **last**; after it → `day-vote` with **no** `sheriff-pull-vote` phase. **Update the 4 existing assertions** that expect `phase === 'sheriff-pull-vote'` (~rules.test.ts:564, 607, 636, 1771).
- No-sheriff day: last speaker has kind `speak` (no 归票).
- Silent voting: vote turns (incl. `sheriff-vote`) produce **empty public text**; `target` is recorded; `thinking` private; PK speech rounds remain public. Wolf `self_explode` still accepted on a vote turn.
- 归票 turn still accepts wolf `self_explode` (D3).
- Full werewolf + interaction-framework suites green (catch stale phase refs).
- Optional: a `playWerewolfE2E` real-game run (previously caught a missing prompt branch).

## Risks / Notes

- Highest-risk edit is the phase removal + the prompt-branch re-key (prompts.ts:580) and self-explode allow-list (prompts.ts:878) — a blind grep-delete of `sheriff-pull-vote` would break the parser/kind. The plan must distinguish **phase** (remove) from **kind** (keep).
- A2 could regress agent behavior in ways unit tests can't see; the optional e2e is the only behavioral guard. The digest↔code sync has no automated check — keep the digest at flow level so it drifts less.
- Drift between agent-facing text and engine (死左/死右 prompt, corpse-adjacency hint) is the failure mode the reviewers flagged; A1a fixes both surfaces.

## Out of scope (→ Sub-project B)

UI: round-table seat visualization and a skill-activation feed (竞选/查验/女巫救毒/狼刀/投票). Separate design; benefits from A's clean events.
