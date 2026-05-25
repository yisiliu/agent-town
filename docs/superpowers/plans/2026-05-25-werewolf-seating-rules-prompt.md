# Werewolf Seating-Order + Code-as-Rules Prompt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the werewolf day-discussion follow a fixed round-table seat order with the sheriff speaking last (归票), make vote-tally turns silent, convey rules to agents as a pseudocode flow digest, and add positional strategy guidance.

**Architecture:** All changes are in the werewolf interaction plugin — a pure-function state machine (`rules.ts` planNextTurn/applyTurn/computeSpeechOrder; `state.ts` types) plus pure prompt builders (`prompts.ts` buildSystemPrompt/buildUserPrompt/parseTurnText) — and one append-site guard in the `interactionTakeTurn` action. State machine and prompt builders are unit-tested directly (no Convex runtime needed); the action-level silencing and the prose→pseudocode prompt rewrites are verified by content-guard tests + an optional real-game e2e.

**Tech Stack:** TypeScript, Convex, Vitest. Spec: `docs/superpowers/specs/2026-05-25-werewolf-seating-rules-prompt.md`.

**Key distinction (do not confuse):** `sheriff-pull-vote` exists as both a **phase** (in `WerewolfPhase`) and a **turn kind** (free-form `kind: string`). This plan **removes the phase** but **keeps the kind**. A blind grep-and-delete of `sheriff-pull-vote` will break the parser — edit deliberately.

**Test-file conventions (read first — there are NO new helpers to invent):** `convex/tests/werewolf-rules.test.ts` builds states with `initialState(nine, 42)` / `initialState(twelve, 7)` (constants `nine`/`twelve` at lines 20-21), picks players by role via `byRole(s, 'seer'|'villager'|…)`, gets a seat with `s.participants.indexOf(id)`, then constructs scenarios with the `{ ...s0, alive, nightDeaths, phase, speechCursor, sheriff }` spread and drives them with `planNextTurn(s)` / `applyTurn(s, turn)`. The death-anchor tests at lines 1521-1612 are the exact template. `buildSystemPrompt`/`buildUserPrompt` are already imported and used in this file. **Do not invent helpers; match this style. Never hardcode a sheriff seat — `initialState` shuffles roles, so derive the seat from `indexOf`.**

**Prompt-builder arg shapes:** `buildUserPrompt({ state, actorTwinId, phase, kind, visibleTurns: [], aliveNames: {} })`; `buildSystemPrompt({ state, actorTwinId, cardMarkdown: '', aliveNames: {} })`. `aliveNames`/`visibleTurns` can be empty in tests (names fall back to the twin id). The A2 rules digest lives in the `GAME_RULES_CLASS` constant used by `buildSystemPrompt`.

---

## File Structure

| File | Responsibility | Changes |
|---|---|---|
| `convex/ours/interactions/werewolf/state.ts` | Phase/state types | Remove `'sheriff-pull-vote'` from `WerewolfPhase` union (~line 43) |
| `convex/ours/interactions/werewolf/rules.ts` | Pure state machine | Anchor speech on sheriff; drop victim-anchor; remove `sheriff-pull-vote` phase branches; fold 归票 into day-speak's last (sheriff-identity) turn |
| `convex/ours/interactions/werewolf/prompts.ts` | Pure prompt builders + parser | Re-key 归票 user-prompt to `kind`; add `sheriff-pull-vote` to self-explode allow-list; rewrite day-direction prompt to 警左/警右; drop `say` from vote prompts; pseudocode digest in `GAME_RULES_CLASS`; positional strategy prose; remove stale corpse-adjacency hint |
| `convex/ours/actions/interactionTakeTurn.ts` | Turn execution (action) | Blank public say-text for the 4 vote kinds (mirror sheriff-claim precedent ~186-188) |
| `convex/tests/werewolf-rules.test.ts` | Unit tests | Rewrite death-anchor tests; update 4 pull-vote assertions; add sheriff-anchor + 归票 + silent-vote + prompt-content tests |

---

## Task 1: Sheriff-anchored seating + 归票 as the last day-speak turn

Core, highest-risk change; must land atomically (intermediate states double-speak the sheriff). Combines spec A1a (logic) + A1b.

**Files:** `state.ts` (union ~43); `rules.ts` (day-direction apply 1163-1186; day-speak planNextTurn 467-475; day-speak apply 1188-1207; remove sheriff-pull-vote planNextTurn 428-434 + apply 1155-1161); `prompts.ts` (归票 guard 580; self-explode allow-list 878); `werewolf-rules.test.ts`.

- [ ] **Step 1: Write failing tests for sheriff-anchored speech order** (follow the 1521-1612 template):

```ts
it('警左: day-speak order anchors on sheriff, descending, sheriff LAST', () => {
  const s0 = initialState(twelve, 7);
  const sheriff = byRole(s0, 'seer')[0]!;            // any alive player as sheriff
  const seat = s0.participants.indexOf(sheriff);
  const s: WerewolfState = { ...s0, nightDeaths: [], phase: 'day-direction', speechCursor: 0, sheriff };
  const after = applyTurn(s, { phase: 'day-direction', kind: 'day-direction', actorTwinId: sheriff, data: { direction: 'left' } });
  const n = s0.participants.length; const expected: Id<'twins'>[] = [];
  for (let k = 1; k <= n; k++) { const id = s0.participants[((seat - k) % n + n) % n]!; if (after.alive.includes(id)) expected.push(id); }
  expect(after.speechOrder).toEqual(expected);
  expect(after.speechOrder!.at(-1)).toBe(sheriff);   // sheriff last by construction
});

it('警右: ascending from sheriff+1, sheriff LAST', () => {
  const s0 = initialState(twelve, 7);
  const sheriff = byRole(s0, 'seer')[0]!;
  const seat = s0.participants.indexOf(sheriff);
  const s: WerewolfState = { ...s0, nightDeaths: [], phase: 'day-direction', speechCursor: 0, sheriff };
  const after = applyTurn(s, { phase: 'day-direction', kind: 'day-direction', actorTwinId: sheriff, data: { direction: 'right' } });
  expect(after.speechOrder!.at(-1)).toBe(sheriff);
  expect(after.speechOrder![0]).toBe(s0.participants[(seat + 1) % s0.participants.length]);
});

// REGRESSION GUARD for the live bug: sheriff present AND a night death →
// anchor on the SHERIFF, not the victim. Replaces the old 死左/死右 tests.
it('one night-death + sheriff → anchors on sheriff (not victim), sheriff LAST', () => {
  const s0 = initialState(twelve, 7);
  const sheriff = byRole(s0, 'seer')[0]!;
  const victim = byRole(s0, 'villager')[0]!;
  const seat = s0.participants.indexOf(sheriff); const n = s0.participants.length;
  const s: WerewolfState = { ...s0, alive: s0.participants.filter((id) => id !== victim), nightDeaths: [victim], phase: 'day-direction', speechCursor: 0, sheriff };
  const after = applyTurn(s, { phase: 'day-direction', kind: 'day-direction', actorTwinId: sheriff, data: { direction: 'left' } });
  expect(after.speechOrder!.at(-1)).toBe(sheriff);
  expect(after.speechOrder).not.toContain(victim);
  let first; for (let k = 1; k <= n; k++) { const id = s0.participants[((seat - k) % n + n) % n]!; if (after.alive.includes(id)) { first = id; break; } }
  expect(after.speechOrder![0]).toBe(first);          // first alive left of sheriff, NOT victim-adjacent
});
```

- [ ] **Step 2: Run, confirm FAIL** — `npx vitest run convex/tests/werewolf-rules.test.ts -t "anchors on sheriff"`. Expected: FAIL (current code anchors on seat 0 / victim).

- [ ] **Step 3: Implement the anchor change** — in `rules.ts` day-direction apply (1163-1186), replace the `oneDied` victim-anchor block with:
```ts
const hasSheriff = next.sheriff && next.alive.includes(next.sheriff);
const anchorSeat = hasSheriff ? next.participants.indexOf(next.sheriff!) : 0;
```
Delete the now-unused `oneDied`. Leave `computeSpeechOrder` and the `direction` resolution unchanged.

- [ ] **Step 4: Run the anchor tests, confirm PASS.**

- [ ] **Step 5: Write failing tests for 归票-as-last + phase removal** (walk the day-speak round with the real functions — no helper needed):
```ts
function walkToSheriffTurn(after: WerewolfState): WerewolfState {
  let s = after; // after = a day-speak state (post day-direction), cursor 0
  for (let guard = 0; guard < 50; guard++) {
    const plan = planNextTurn(s)!;
    if (plan.kind === 'sheriff-pull-vote') return s;
    s = applyTurn(s, { phase: 'day-speak', kind: 'speak', actorTwinId: plan.actorTwinId!, data: { say: 'x' } });
  }
  throw new Error('never reached sheriff turn');
}

it('sheriff is planned with kind sheriff-pull-vote on their last day-speak turn, then → day-vote', () => {
  const s0 = initialState(twelve, 7);
  const sheriff = byRole(s0, 'seer')[0]!;
  const s: WerewolfState = { ...s0, nightDeaths: [], phase: 'day-direction', speechCursor: 0, sheriff };
  const day = applyTurn(s, { phase: 'day-direction', kind: 'day-direction', actorTwinId: sheriff, data: { direction: 'left' } });
  const atSheriff = walkToSheriffTurn(day);
  expect(planNextTurn(atSheriff)).toMatchObject({ phase: 'day-speak', kind: 'sheriff-pull-vote', actorTwinId: sheriff });
  const next = applyTurn(atSheriff, { phase: 'day-speak', kind: 'sheriff-pull-vote', actorTwinId: sheriff, data: { say: '归票...' } });
  expect(next.phase).toBe('day-vote');
});

it('no-sheriff day: last speaker has kind speak (no 归票)', () => {
  const s0 = initialState(twelve, 7);
  const s: WerewolfState = { ...s0, nightDeaths: [], phase: 'day-direction', speechCursor: 0, sheriff: undefined };
  const day = applyTurn(s, { phase: 'day-direction', kind: 'system', actorTwinId: null });
  let cur = day; const seen: string[] = [];
  for (let g = 0; g < 50; g++) { const p = planNextTurn(cur)!; if (cur.phase !== 'day-speak') break; seen.push(p.kind); cur = applyTurn(cur, { phase: 'day-speak', kind: 'speak', actorTwinId: p.actorTwinId!, data: { say: 'x' } }); }
  expect(seen).not.toContain('sheriff-pull-vote');
});
```
Also **rewrite the existing assertions** expecting `phase === 'sheriff-pull-vote'` (~werewolf-rules.test.ts:565, 608, 636, 1771) to expect the day-speak `sheriff-pull-vote` *kind* then `day-vote`. **Delete** the old victim-anchor tests (~1521, 1553, 1584-1612) — replaced by Step 1's regression guard.

- [ ] **Step 6: Run, confirm new tests fail.**

- [ ] **Step 7: Implement the phase fold** —
  1. `state.ts`: remove `'sheriff-pull-vote'` from `WerewolfPhase` (~43, +doc 40-42).
  2. `rules.ts`: delete the `sheriff-pull-vote` planNextTurn branch (428-434) and apply branch (1155-1161).
  3. `rules.ts` day-speak planNextTurn (467-475): pick kind by **identity**:
     ```ts
     const kind = actor === s.sheriff ? 'sheriff-pull-vote' : 'speak';
     return { phase: 'day-speak', kind, actorTwinId: actor, visibility: 'public' };
     ```
  4. `rules.ts` day-speak apply (1188-1207): accept `'sheriff-pull-vote'` alongside `'speak'`/`'abstain'`; when cursor passes the last alive entry, set `next.phase = 'day-vote'; next.cursor = 0;` (delete the `if (sheriff) → 'sheriff-pull-vote'` branch at 1199-1200).
  5. `prompts.ts`: re-key the 归票 user-prompt (580) from `phase === 'sheriff-pull-vote' && kind === …` to **`kind === 'sheriff-pull-vote'`**. **Leave** `parseTurnText` (911, already kind-only).
  6. `prompts.ts`: add `'sheriff-pull-vote'` to the self-explode allow-list (878): `… || kind === 'sheriff-pull-vote'`.

- [ ] **Step 8: Run full werewolf + interaction-framework suites** — `npx vitest run convex/tests/werewolf-rules.test.ts convex/tests/interaction-framework.test.ts`. Fix any stale phase refs. Expected: PASS.
- [ ] **Step 9: Typecheck** — `npx tsc --noEmit -p convex`. Expected: exit 0.
- [ ] **Step 10: Commit** — `git add -A && git commit -m "fix(werewolf): sheriff-anchored seating + 归票 as last day-speak turn"`

---

## Task 2: day-direction prompt → 警左/警右, remove corpse-adjacency hint

**Files:** `prompts.ts` (day-direction prompt 690-692; focusHints rule 3 ~324-336); `werewolf-rules.test.ts`.

- [ ] **Step 1: Write a content-guard test (genuine red — the death-case prompt currently says 死左):**
```ts
it('day-direction prompt offers 警左/警右, never 死左/死右 (even with a night death)', () => {
  const s0 = initialState(twelve, 7);
  const sheriff = byRole(s0, 'seer')[0]!;
  const victim = byRole(s0, 'villager')[0]!;
  const s: WerewolfState = { ...s0, alive: s0.participants.filter((id) => id !== victim), nightDeaths: [victim], phase: 'day-direction', speechCursor: 0, sheriff };
  const p = buildUserPrompt({ state: s, actorTwinId: sheriff, phase: 'day-direction', kind: 'day-direction', visibleTurns: [], aliveNames: {} });
  expect(p).toContain('警左');
  expect(p).not.toContain('死左');
  expect(p).not.toContain('死右');
});
```
- [ ] **Step 2: Run, confirm FAIL** (current prompt contains 死左/死右 when a death occurred — prompts.ts:690-691).
- [ ] **Step 3: Implement** — rewrite prompts.ts:690-692 so BOTH the death and no-death cases say e.g. `请选择发言方向：**警左** 或 **警右**（从你警长座位的左/右侧顺位起，绕一圈，你最后归票）。`. Remove the corpse-adjacency hint in `focusHints` rule (3) (~324-336); its positional intent moves to Task 5.
- [ ] **Step 4: Run, confirm PASS.**
- [ ] **Step 5: Commit** — `git commit -am "fix(werewolf): day-direction prompt uses 警左/警右 (drop 死左/死右)"`

---

## Task 3: Silent voting

**Files:** `prompts.ts` (vote prompts: day-vote 750, sheriff-vote 577, day-pk-vote 819, sheriff-pk-vote ~540); `interactionTakeTurn.ts` (append-site blanking ~186-199); `werewolf-rules.test.ts`.

- [ ] **Step 1: Write a content-guard test (genuine red — vote prompts currently include a `"say"` field):**
```ts
it('day-vote prompt requests target + private thinking, no public say', () => {
  const s0 = initialState(twelve, 7);
  const actor = s0.alive[0]!;
  const s: WerewolfState = { ...s0, phase: 'day-vote', cursor: 0 };
  const p = buildUserPrompt({ state: s, actorTwinId: actor, phase: 'day-vote', kind: 'vote', visibleTurns: [], aliveNames: {} });
  expect(p).not.toContain('"say"');         // JSON field removed (robust to wording)
  expect(p).toContain('target');
});
```
(Add analogous cases for `sheriff-vote`, `sheriff-pk-vote`, `day-pk-vote` — each needs its phase set and its candidate list populated: `sheriff-vote`/`sheriff-pk-vote` need `sheriffCandidates`; `day-pk-vote` needs `dayPkCandidates`. Mirror how the existing PK/sheriff tests in this file build those states.)
- [ ] **Step 2: Run, confirm FAIL.**
- [ ] **Step 3: Implement prompt change** — in the 4 vote prompts, drop the `"say"` field from the Respond-JSON contract → `{"thinking":"...","action":{"target":"..."}}`. **Keep** the wolf `self_explode` action option where present today (day-vote:750). Add: 投票阶段不公开发言，理由只写在 thinking 里。
- [ ] **Step 4: Implement append-site blanking** — in `interactionTakeTurn.ts`, extend the existing `sheriff-claim` silence precedent (~186-188, forces `sayField=''`) to also blank `sayField` when `plan.kind ∈ { 'vote', 'sheriff-vote', 'sheriff-pk-vote', 'day-pk-vote' }`. Do NOT touch the PK *speech* kinds. The vote `target` still flows into `pendingVotes`. **Note:** this blanking lands before the self-explode override (~192), so a wolf self-exploding on a vote turn still gets the existing `'我自爆！'` default text — correct, don't "fix" it.
- [ ] **Step 5: Run the prompt-content tests, confirm PASS.**
- [ ] **Step 6: Run full werewolf + interaction-framework suites** — confirm vote tally / day-resolve still pass. Expected: PASS.
- [ ] **Step 7: Commit** — `git commit -am "feat(werewolf): silent voting — vote turns emit private thinking + target, no public 发言"`

---

## Task 4: Rules as pseudocode flow digest (A2)

**Not classic red-green** — this is a prose→pseudocode rewrite of `GAME_RULES_CLASS`. Primary verification is reading the rendered prompt + the e2e (Task 6). Add a light regression-guard (it may already partially pass — its job is to lock the post-change contract, per spec D4).

**Files:** `prompts.ts` (`GAME_RULES_CLASS` constant used by `buildSystemPrompt`); `werewolf-rules.test.ts`.

- [ ] **Step 1: Add a regression-guard test** (negative guard is the meaningful one):
```ts
it('system prompt is a flow digest, not engine resolution internals', () => {
  const s0 = initialState(twelve, 7);
  const sp = buildSystemPrompt({ state: s0, actorTwinId: byRole(s0, 'villager')[0]!, cardMarkdown: '', aliveNames: {} });
  expect(sp).toMatch(/归票|发言顺序|按座位/);            // flow present
  expect(sp).not.toMatch(/pendingWolfKill|XOR|guarded \^ saved/); // no kill-math leaked to a villager
});
```
- [ ] **Step 2: Run** (may already pass — that's acceptable for a content guard; note it's not a TDD red).
- [ ] **Step 3: Implement** — replace the prose rule sections of `GAME_RULES_CLASS` with a compact pseudocode digest: phase flow (night 守→狼→女→预 → resolve → [hunter]→[last-words] → day-1 sheriff election → day-direction → day-speak seat order, **sheriff last** → silent day-vote → resolve → next night), win conditions, and per-phase whose-turn/what-action. Keep role-specific abilities (witch/seer/guard/hunter) in `ROLE_BRIEFINGS` only, NOT in the shared digest. Pseudocode, shorter than the prose replaced.
- [ ] **Step 4: Run the guard, confirm PASS; manually read** the rendered system prompt for a villager AND a wolf — confirm clarity and that no role-secret info leaks into the shared digest.
- [ ] **Step 5: Commit** — `git commit -am "feat(werewolf): convey rules as pseudocode flow digest"`

---

## Task 5: Positional strategy guidance (A3)

**Not classic red-green** — prose addition; verified by read + e2e, with a regression-guard lock.

**Files:** `prompts.ts` (strategy prose, in `GAME_RULES_CLASS` or `ROLE_BRIEFINGS`); `werewolf-rules.test.ts`.

- [ ] **Step 1: Add a regression-guard test:**
```ts
it('strategy guidance covers speaking-order leverage', () => {
  const s0 = initialState(twelve, 7);
  const sp = buildSystemPrompt({ state: s0, actorTwinId: byRole(s0, 'werewolf')[0]!, cardMarkdown: '', aliveNames: {} });
  expect(sp).toMatch(/发言顺序|先发言|后发言.*归票|位置/);
});
```
- [ ] **Step 2: Run** (may already partially pass; content guard, not a red).
- [ ] **Step 3: Implement** — add prose: early speakers (little info / set tone / 起跳) vs late (see all / 抗推 / 归票); sheriff 归票 = highest leverage; 警左/警右 is tactical; weigh your seat + today's direction. Absorbs the removed corpse-adjacency hint's intent.
- [ ] **Step 4: Run guard, confirm PASS; read the rendered prompt.**
- [ ] **Step 5: Commit** — `git commit -am "feat(werewolf): positional/seat strategy guidance"`

---

## Task 6: Whole-feature verification

- [ ] **Step 1: Full suite** — `npx vitest run`. Expected: PASS except the KNOWN pre-existing unrelated failures (card-validator / uploadFixtures / uploadPipeline — confirm they're unchanged by stashing if unsure).
- [ ] **Step 2: Typecheck** — `npx tsc --noEmit -p convex`. Expected: exit 0.
- [ ] **Step 3: Repo CI guard scripts** — `bash scripts/check-no-bare-llm-calls.sh` and `bash scripts/check-ai-town-additivity.sh`. Expected: PASS (rm any stray `tsconfig.tsbuildinfo` the tsc run leaves before the additivity check).
- [ ] **Step 4 (recommended): Real-game e2e** — run `convex/ours/actions/playWerewolfE2E` (9p, then 12p with `maxLlmTurns`) on dev; read the transcript: seat-order speech, sheriff归票 last, silent votes, and that 自爆/PK/遗言/猎人 still fire. Only behavioral guard for Tasks 2-5.
- [ ] **Step 5: finishing-a-development-branch** — REQUIRED SUB-SKILL: verify tests, then merge/PR per that skill.

---

## Notes for the implementer
- `rules.ts` state machine and `prompts.ts` builders are **pure functions** — test by direct calls, no Convex runtime.
- `clone()` (rules.ts:34-77) has **no** `sheriff-pull-vote` field, so no clone/reset field surgery — but confirm the type checker is happy after removing the phase from the union.
- Keep changes surgical; match the existing test style (`initialState` + `byRole` + `{...s0}` spread). Don't restructure unrelated code.
- Line numbers are anchors from a 2026-05-25 read; if drifted, locate by the surrounding code described.
