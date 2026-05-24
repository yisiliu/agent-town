# 狼人杀京城大师赛规则对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the werewolf game with 京城大师赛/竞技标准局 (预女猎守) — add the guard role + 12-player board, rewrite night resolve as a 3-input guard×save×poison kill gate (奶穿/毒穿), add directional speech order, night-dead-sheriff badge transfer, daytime PK tie-break, and seer-reveals-alignment-only.

**Architecture:** Extend the existing pure state-machine in `rules.ts` — new phases (`night-guard`, `sheriff-night-badge`, `day-direction`, `day-pk-speech`, `day-pk-vote`) slot into `planNextTurn`/`applyTurn`; new `WerewolfState` fields thread through `clone()` + all reset blocks; prompt builders gain branches for the new turn kinds. No new files; everything lives in the four werewolf modules plus the existing test file.

**Tech Stack:** Convex + TypeScript, vitest, pure-function state machine.

Test runner: `npx vitest run convex/tests/werewolf-rules.test.ts`
Typecheck: `npx tsc --noEmit -p convex/tsconfig.json`

Conventions established by the existing code (mirror these exactly):
- `asKey(id)` = `id as unknown as string` for record keys.
- `aliveByRole(s, role)` = `s.alive.filter(id => s.roles[asKey(id)] === role)`.
- `clone(s)` deep-copies arrays/records field-by-field; **every new field must be added there**.
- Phase transitions go through `transitionAfterResolve(next, fromNightResolve)` whenever a death/resolve event happens (handles checkWin → hunter-shoot → last-words → next phase).
- Test helper imports: `initialState, planNextTurn, applyTurn, checkWin` from `rules`; `byRole(s, role)`, `skipSheriffElection(s)`, `P(n)`, `nine` from the test file's own top-level helpers.
- 12-player roster: add `const twelve = [P(0)..P(11)]` alongside the existing `nine`.

---

## Unit 1 — 守卫 + 夜间结算重写 + 板子/checkWin/12 人

> Highest risk: touches `applyNightResolve` (the most load-bearing function), `checkWin`, role assignment, and adds a new night phase. Drive it with the 奶穿/毒穿 truth table as the test spec.

### Task 1.1 — Add `'guard'` to `WerewolfRole` + 12-player board

**Files:**
- Modify `convex/ours/interactions/werewolf/state.ts` (line 7: role union)
- Modify `convex/ours/interactions/werewolf/rules.ts` (`assignRoles` ~75-103)
- Test: `convex/tests/werewolf-rules.test.ts` (new `describe` near the 9p config block ~72)

- [ ] Add `twelve` constant to the test file near `nine` (line ~20):
  ```ts
  const twelve = [P(0), P(1), P(2), P(3), P(4), P(5), P(6), P(7), P(8), P(9), P(10), P(11)];
  ```
- [ ] Write failing test — 9p board unchanged (no guard), 12p board = 4 wolves / seer·witch·hunter·guard / 4 villagers:
  ```ts
  describe('werewolf rules — board tables (9p no-guard, 12p 预女猎守)', () => {
    it('9p has NO guard (3W / S·W·H / 3V)', () => {
      const s = initialState(nine, 42);
      expect(byRole(s, 'werewolf').length).toBe(3);
      expect(byRole(s, 'guard').length).toBe(0);
      expect(byRole(s, 'seer').length).toBe(1);
      expect(byRole(s, 'witch').length).toBe(1);
      expect(byRole(s, 'hunter').length).toBe(1);
      expect(byRole(s, 'villager').length).toBe(3);
    });
    it('12p is 4W / S·W·H·G / 4V', () => {
      const s = initialState(twelve, 7);
      expect(byRole(s, 'werewolf').length).toBe(4);
      expect(byRole(s, 'seer').length).toBe(1);
      expect(byRole(s, 'witch').length).toBe(1);
      expect(byRole(s, 'hunter').length).toBe(1);
      expect(byRole(s, 'guard').length).toBe(1);
      expect(byRole(s, 'villager').length).toBe(4);
    });
  });
  ```
- [ ] Run it — expect FAIL: `npx vitest run convex/tests/werewolf-rules.test.ts`
      Expected message: `expected 0 to be 1` (no `'guard'` ever assigned; the 12p case currently falls into the generic fallback that emits no guard).
- [ ] Minimal implementation — `state.ts` line 7:
  ```ts
  export type WerewolfRole = 'werewolf' | 'seer' | 'witch' | 'hunter' | 'guard' | 'villager';
  ```
- [ ] Add the 12p branch to `assignRoles` in `rules.ts` (after the `if (n === 9)` block, before the fallback):
  ```ts
  if (n === 12) {
    // 4 wolves, 1 seer, 1 witch, 1 hunter, 1 guard, 4 villagers (预女猎守).
    roles[asKey(shuffled[0]!)] = 'werewolf';
    roles[asKey(shuffled[1]!)] = 'werewolf';
    roles[asKey(shuffled[2]!)] = 'werewolf';
    roles[asKey(shuffled[3]!)] = 'werewolf';
    roles[asKey(shuffled[4]!)] = 'seer';
    roles[asKey(shuffled[5]!)] = 'witch';
    roles[asKey(shuffled[6]!)] = 'hunter';
    roles[asKey(shuffled[7]!)] = 'guard';
    for (let i = 8; i < n; i++) roles[asKey(shuffled[i]!)] = 'villager';
    return roles;
  }
  ```
- [ ] Run it — expect PASS.
- [ ] Commit: `feat(werewolf): add guard role + 12-player 预女猎守 board`

### Task 1.2 — `checkWin` counts gods generically (non-wolf-non-villager)

**Files:**
- Modify `convex/ours/interactions/werewolf/rules.ts` (`checkWin` ~167-186)
- Test: `convex/tests/werewolf-rules.test.ts` (extend the existing `checkWin (屠边)` describe ~707)

- [ ] Write failing test — 12p 屠神边 must require the guard dead too:
  ```ts
  it('12p 屠神边 needs ALL gods incl. guard dead', () => {
    const s0 = initialState(twelve, 7);
    const wolves = byRole(s0, 'werewolf');
    const villagers = byRole(s0, 'villager');
    const guard = byRole(s0, 'guard')[0]!;
    // wolves + villagers + guard alive (guard is a god) → NOT ended yet
    const withGuard: WerewolfState = { ...s0, alive: [...wolves, ...villagers, guard] };
    expect(checkWin(withGuard)).toEqual({ ended: false });
    // drop the guard too → all gods dead → wolves win
    const noGods: WerewolfState = { ...s0, alive: [...wolves, ...villagers] };
    expect(checkWin(noGods)).toEqual({ ended: true, winner: 'werewolves' });
  });
  ```
- [ ] Run it — expect FAIL: with the guard alive, the current hard-coded `seer+witch+hunter` count is 0, so it wrongly returns `{ ended: true, winner: 'werewolves' }`.
      Expected message: `expected { ended: true, winner: 'werewolves' } to deeply equal { ended: false }`.
- [ ] Minimal implementation — replace the god-count lines in `checkWin`:
  ```ts
  const wolves = aliveByRole(s, 'werewolf');
  if (wolves.length === 0) return { ended: true, winner: 'villagers' };
  // Gods = any alive role that is neither wolf nor villager (seer/witch/hunter/guard).
  // Generic count auto-adapts to both the 9p (no guard) and 12p (with guard) boards.
  const aliveGods = s.alive.filter((id) => {
    const r = s.roles[asKey(id)];
    return r !== 'werewolf' && r !== 'villager';
  }).length;
  const aliveCivilians = aliveByRole(s, 'villager').length;
  if (aliveGods === 0) return { ended: true, winner: 'werewolves' };
  if (aliveCivilians === 0) return { ended: true, winner: 'werewolves' };
  return { ended: false };
  ```
- [ ] Run it — expect PASS (and the existing 9p checkWin tests still green).
- [ ] Commit: `refactor(werewolf): checkWin counts gods generically (non-wolf-non-villager)`

### Task 1.3 — New state fields for guard + `night-guard` phase wiring (clone + all resets)

**Files:**
- Modify `convex/ours/interactions/werewolf/state.ts` (`WerewolfPhase` union ~9-53; `WerewolfState` ~74-145)
- Modify `convex/ours/interactions/werewolf/rules.ts` (`clone` ~34-67; `initialState` ~130-160; night-reset in `transitionAfterResolve` ~216-226; self-explode reset ~573-583)
- Test: `convex/tests/werewolf-rules.test.ts`

- [ ] Add phases to the `WerewolfPhase` union in `state.ts` (place `night-guard` first since it is the new night head):
  ```ts
  | 'night-guard'
  | 'sheriff-night-badge'
  | 'day-direction'
  | 'day-pk-speech'
  | 'day-pk-vote'
  ```
- [ ] Add fields to `WerewolfState` interface (in the night-state and day-state regions):
  ```ts
  // Guard's protect target this night (盲守, set during night-guard). Cleared each night.
  guardTargetThisNight?: Id<'twins'>;
  // Who the guard protected LAST night — cannot guard the same player twice in a row.
  lastGuardTarget?: Id<'twins'>;
  // Snapshotted AFTER night last-words + hunter-shoot resolve so it excludes the dead.
  speechOrder?: Id<'twins'>[];
  // Independent cursor into speechOrder for day-speak (NOT the day-vote cursor).
  speechCursor?: number;
  // 'left' | 'right' direction relative to the anchor (death seat or sheriff seat).
  speechDirection?: 'left' | 'right';
  // Daytime PK tie-break state (mirrors sheriffPk* shape).
  dayPkCandidates?: Id<'twins'>[];
  dayPkVotes?: Record<string, string>;
  dayPkActive?: boolean;
  ```
- [ ] Add **every** new field to `clone()` in `rules.ts` (this is the #1 silent-drop bug — do not skip):
  ```ts
  guardTargetThisNight: s.guardTargetThisNight,
  lastGuardTarget: s.lastGuardTarget,
  speechOrder: s.speechOrder ? s.speechOrder.slice() : undefined,
  speechCursor: s.speechCursor,
  speechDirection: s.speechDirection,
  dayPkCandidates: s.dayPkCandidates ? s.dayPkCandidates.slice() : undefined,
  dayPkVotes: s.dayPkVotes ? { ...s.dayPkVotes } : undefined,
  dayPkActive: s.dayPkActive,
  ```
- [ ] Set `initialState.phase` to `'night-guard'` and initialize the new night fields:
  ```ts
  phase: 'night-guard',
  ...
  guardTargetThisNight: undefined,
  lastGuardTarget: undefined,
  ```
  (Leave `speechOrder/speechCursor/speechDirection/dayPk*` as `undefined`, i.e. simply omit them — they default-initialize lazily; do NOT add them to the deadlock-prone reset paths unless a later task needs them.)
- [ ] In `transitionAfterResolve`'s night-reset block (the `else` branch ~216-226), set the new night head to `night-guard` and clear `guardTargetThisNight` (DO NOT clear `lastGuardTarget` — it must survive into the next night for the no-repeat rule):
  ```ts
  next.phase = 'night-guard';
  next.cursor = 0;
  next.day += 1;
  next.wolfVotes = {};
  next.pendingWolfKill = undefined;
  next.pendingPoisonTarget = undefined;
  next.witchSaveUsedTonight = false;
  next.nightDeaths = [];
  next.poisonedThisNight = [];
  next.guardTargetThisNight = undefined;
  ```
- [ ] In the self-explode reset block (~573-583), match the same night-reset (self-explode also rolls straight into the next night):
  ```ts
  next.guardTargetThisNight = undefined;
  next.day += 1;
  next.phase = 'night-guard';
  ```
  (Change the existing `next.phase = 'night-werewolf'` to `'night-guard'`; add the `guardTargetThisNight` clear above it.)
- [ ] Write failing test — fresh game starts at `night-guard`:
  ```ts
  it('initialState phase is night-guard', () => {
    expect(initialState(nine, 42).phase).toBe('night-guard');
    expect(initialState(twelve, 7).phase).toBe('night-guard');
  });
  ```
- [ ] Run it — expect FAIL: `expected 'night-werewolf' to be 'night-guard'` (until `initialState.phase` is changed). (Note: this same change will break many existing tests that begin bidding at `night-werewolf`; Task 1.4 supplies the `planNextTurn` skip + a test helper so the existing tests still pass.)
- [ ] Implement the `initialState.phase` change above.
- [ ] Run it — the new test PASSES but expect several existing night tests to FAIL because they apply a `night-werewolf` turn while state is at `night-guard`. That is fixed in Task 1.4. Do NOT commit a red suite — proceed straight to 1.4 and commit them together.

### Task 1.4 — `planNextTurn` + `applyTurn` for `night-guard` (with no/dead-guard skip)

**Files:**
- Modify `convex/ours/interactions/werewolf/rules.ts` (`planNextTurn` — add a `night-guard` branch before `night-werewolf` ~235; `applyTurn` — add a `night-guard` handler before the `night-werewolf` handler ~595)
- Modify `convex/tests/werewolf-rules.test.ts` (add an `advanceToWerewolf` helper + adapt the per-test night drivers)

- [ ] Add an `advanceToWerewolf(s)` helper to the test file (mirrors `skipSheriffElection` style). It drives the new `night-guard` phase. For 9p it auto-skips (no guard); for 12p it issues a no-target guard turn so we don't entangle guard logic into unrelated tests:
  ```ts
  // Drives night-guard → night-werewolf. 9p has no guard (system skip); 12p
  // issues an empty guard action (空守) unless the test set guardTargetThisNight itself.
  function advanceToWerewolf(s: WerewolfState): WerewolfState {
    let cur = s;
    while (cur.phase === 'night-guard') {
      const plan = planNextTurn(cur)!;
      if (plan.kind === 'system') {
        cur = applyTurn(cur, { phase: 'night-guard', kind: 'system', actorTwinId: null });
      } else {
        cur = applyTurn(cur, { phase: 'night-guard', kind: 'guard-protect', actorTwinId: plan.actorTwinId, data: {} });
      }
    }
    return cur;
  }
  ```
- [ ] Write failing test — 9p skips guard automatically; 12p emits a guard turn:
  ```ts
  describe('werewolf rules — night-guard phase', () => {
    it('9p emits a system skip (no guard) then lands on night-werewolf', () => {
      const s = initialState(nine, 42);
      const plan = planNextTurn(s)!;
      expect(plan.kind).toBe('system'); // no guard to protect
      const s2 = applyTurn(s, { phase: 'night-guard', kind: 'system', actorTwinId: null });
      expect(s2.phase).toBe('night-werewolf');
    });
    it('12p emits a guard-protect turn for the living guard', () => {
      const s = initialState(twelve, 7);
      const guard = byRole(s, 'guard')[0]!;
      const plan = planNextTurn(s)!;
      expect(plan.kind).toBe('guard-protect');
      expect(plan.actorTwinId).toBe(guard);
      expect(plan.visibility).toEqual([guard]);
    });
    it('guard cannot protect the same target two nights running (违规按空守)', () => {
      let s = initialState(twelve, 7);
      const guard = byRole(s, 'guard')[0]!;
      const villager = byRole(s, 'villager')[0]!;
      s = applyTurn(s, { phase: 'night-guard', kind: 'guard-protect', actorTwinId: guard, data: { target: villager } });
      expect(s.guardTargetThisNight).toBe(villager);
      expect(s.phase).toBe('night-werewolf');
      // (no-repeat enforcement is verified end-to-end in Task 1.6 across nights)
    });
  });
  ```
- [ ] Run it — expect FAIL: `planNextTurn` has no `night-guard` branch so it falls through to `night-werewolf`/returns the wolf bid; `expected 'wolf-kill-bid' to be 'system'`.
- [ ] Add the `night-guard` branch to `planNextTurn` (place it as the first `if` after the `ended` guard, before `night-werewolf`). Mirror the seer/witch skip pattern at lines 262-276:
  ```ts
  if (s.phase === 'night-guard') {
    const guard = aliveByRole(s, 'guard')[0];
    if (!guard) {
      return { phase: 'night-guard', kind: 'system', actorTwinId: null, visibility: 'public', systemText: 'No guard to protect tonight.' };
    }
    return { phase: 'night-guard', kind: 'guard-protect', actorTwinId: guard, visibility: [guard] };
  }
  ```
- [ ] Add the `night-guard` handler to `applyTurn` (place before the `night-werewolf` handler ~595). Enforce no-repeat (违规按空守), allow self-guard, allow empty/空守:
  ```ts
  if (s.phase === 'night-guard' && (t.kind === 'guard-protect' || t.kind === 'system' || t.kind === 'abstain')) {
    const next = clone(s);
    if (t.kind === 'guard-protect' && t.actorTwinId) {
      const target = (t.data as { target?: Id<'twins'> })?.target;
      // Valid only if alive AND not the same player guarded last night. Repeat or
      // missing target → 空守 (guardTargetThisNight stays undefined).
      if (
        target &&
        next.alive.includes(target) &&
        next.roles[asKey(t.actorTwinId)] === 'guard' &&
        !(next.lastGuardTarget && target === next.lastGuardTarget)
      ) {
        next.guardTargetThisNight = target;
      }
    }
    next.phase = 'night-werewolf';
    return next;
  }
  ```
- [ ] Update **every** existing test that drives a night to route through `advanceToWerewolf`. Concretely: at each spot that does the first `for (const w of wolves) applyTurn(..., 'night-werewolf', 'wolf-kill-bid', ...)`, insert `s = advanceToWerewolf(s);` immediately before the wolf loop. (Search the test file for `phase: 'night-werewolf', kind: 'wolf-kill-bid'` — each block's first occurrence per night needs the prefix. The `night-2` wolf loops inside multi-day tests do NOT need it because `transitionAfterResolve` lands on `night-guard` and those tests immediately re-bid — add `advanceToWerewolf` there too. Walk every failing test and fix the entry.)
- [ ] Add `guard-protect` to `parseTurnText` (`prompts.ts` ~856-868 block — it shares the `target`-optional family but guard target may be omitted for 空守):
  ```ts
  if (kind === 'guard-protect') {
    const target = typeof action?.target === 'string' ? action.target : undefined;
    if (target && !allowed.includes(target)) {
      return { ok: false, error: `guard target "${target}" not in alive set` };
    }
    return { ok: true, data: { thinking, say, target } };
  }
  ```
- [ ] Run it — expect PASS (the night-guard tests and ALL previously-broken night tests now green).
- [ ] Run the full file once: `npx vitest run convex/tests/werewolf-rules.test.ts` — expect all green.
- [ ] Typecheck: `npx tsc --noEmit -p convex/tsconfig.json`.
- [ ] Commit: `feat(werewolf): add night-guard phase (盲守, no-repeat, self/empty allowed) with 9p auto-skip`

### Task 1.5 — Night order: 守卫→狼→女巫→预言家 (witch before seer)

> Spec §11 / night order: the standard wake order is guard → wolves → **witch → seer** → resolve. The current code goes wolves → seer → witch. Move witch ahead of seer.

**Files:**
- Modify `convex/ours/interactions/werewolf/rules.ts` (the `night-werewolf` bid handler's sub-phase pick ~609-612; the `night-witch` handler's exit ~663; the `night-seer` handler's exit ~627)
- Test: `convex/tests/werewolf-rules.test.ts`

- [ ] Write failing test — after all wolves bid, the next night phase is `night-witch`, and after witch acts it is `night-seer`:
  ```ts
  it('night order is guard→wolf→witch→seer→resolve', () => {
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    for (const w of wolves) {
      s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
    }
    expect(s.phase).toBe('night-witch');   // witch BEFORE seer now
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    expect(s.phase).toBe('night-seer');
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    expect(s.phase).toBe('night-resolve');
  });
  ```
- [ ] Run it — expect FAIL: current order routes wolves→`night-seer`; `expected 'night-seer' to be 'night-witch'`.
- [ ] In the `night-werewolf` bid handler (~609-612), change the sub-phase pick to prefer witch first:
  ```ts
  if (aliveByRole(next, 'witch').length > 0) next.phase = 'night-witch';
  else if (aliveByRole(next, 'seer').length > 0) next.phase = 'night-seer';
  else next.phase = 'night-resolve';
  ```
- [ ] In the `night-witch` handler exit (~663), go to seer next:
  ```ts
  next.phase = aliveByRole(next, 'seer').length > 0 ? 'night-seer' : 'night-resolve';
  ```
- [ ] In the `night-seer` handler exit (~627), seer always goes straight to resolve now:
  ```ts
  next.phase = 'night-resolve';
  ```
- [ ] Update the existing per-test night drivers that ordered `peek` then `witch-act` — swap them to `witch-act` then `peek`. (Search for `kind: 'peek'` followed by `kind: 'witch-act'` in the test file; reorder each so witch acts first. The witch self-save tests and hunter/last-words/sheriff helpers all contain this pair — fix every one.)
- [ ] Run it — expect PASS across the file.
- [ ] Typecheck.
- [ ] Commit: `refactor(werewolf): night wake order guard→wolf→witch→seer (standard)`

### Task 1.6 — Rewrite `applyNightResolve` as 3-input kill gate (奶穿 / 毒穿盾)

> The core of Unit 1. Implements the truth table from spec §3. `lastGuardTarget = guardTargetThisNight` rotation happens here.

**Files:**
- Modify `convex/ours/interactions/werewolf/rules.ts` (`applyNightResolve` ~430-484)
- Test: `convex/tests/werewolf-rules.test.ts` (new describe block)

- [ ] Write the truth-table tests (12p so a guard exists). Use a helper to set up a night with explicit guard/save/poison:
  ```ts
  describe('werewolf rules — night resolve 3-input gate (守×救×毒)', () => {
    // Returns state at night-guard for a fresh 12p game.
    function n1(): WerewolfState { return initialState(twelve, 7); }

    it('守+救 both protect the SAME wolf target → 奶穿: target DIES, counts as 狼刀 (hunter could shoot)', () => {
      let s = n1();
      const wolves = byRole(s, 'werewolf');
      const guard = byRole(s, 'guard')[0]!;
      const witch = byRole(s, 'witch')[0]!;
      const seer = byRole(s, 'seer')[0]!;
      const hunter = byRole(s, 'hunter')[0]!;
      // guard protects the hunter; wolves knife the hunter; witch saves the hunter.
      s = applyTurn(s, { phase: 'night-guard', kind: 'guard-protect', actorTwinId: guard, data: { target: hunter } });
      for (const w of wolves) {
        s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: hunter } });
      }
      s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: { use_save: true } });
      s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
      s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
      expect(s.alive).not.toContain(hunter);          // 奶穿 → dies
      expect(s.poisonedThisNight).not.toContain(hunter); // NOT poisoned → hunter shot allowed
      expect(s.pendingHunterShot).toBe(hunter);       // hunter can shoot (death = 狼刀)
    });

    it('守 only (no save) → target LIVES', () => {
      let s = n1();
      const wolves = byRole(s, 'werewolf');
      const guard = byRole(s, 'guard')[0]!;
      const witch = byRole(s, 'witch')[0]!;
      const seer = byRole(s, 'seer')[0]!;
      const villager = byRole(s, 'villager')[0]!;
      s = applyTurn(s, { phase: 'night-guard', kind: 'guard-protect', actorTwinId: guard, data: { target: villager } });
      for (const w of wolves) {
        s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
      }
      s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
      s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
      s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
      expect(s.alive).toContain(villager);
    });

    it('救 only (no guard) → target LIVES', () => {
      let s = n1();
      const wolves = byRole(s, 'werewolf');
      const guard = byRole(s, 'guard')[0]!;
      const witch = byRole(s, 'witch')[0]!;
      const seer = byRole(s, 'seer')[0]!;
      const villager = byRole(s, 'villager')[0]!;
      s = applyTurn(s, { phase: 'night-guard', kind: 'guard-protect', actorTwinId: guard, data: {} }); // 空守
      for (const w of wolves) {
        s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
      }
      s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: { use_save: true } });
      s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
      s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
      expect(s.alive).toContain(villager);
    });

    it('neither 守 nor 救 → target DIES (狼刀)', () => {
      let s = n1();
      const wolves = byRole(s, 'werewolf');
      const guard = byRole(s, 'guard')[0]!;
      const witch = byRole(s, 'witch')[0]!;
      const seer = byRole(s, 'seer')[0]!;
      const villager = byRole(s, 'villager')[0]!;
      s = applyTurn(s, { phase: 'night-guard', kind: 'guard-protect', actorTwinId: guard, data: {} });
      for (const w of wolves) {
        s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
      }
      s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
      s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
      s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
      expect(s.alive).not.toContain(villager);
    });

    it('毒穿盾: guard protects + witch poisons the SAME target → DIES, counts as 毒 (hunter blocked)', () => {
      let s = n1();
      const wolves = byRole(s, 'werewolf');
      const guard = byRole(s, 'guard')[0]!;
      const witch = byRole(s, 'witch')[0]!;
      const seer = byRole(s, 'seer')[0]!;
      const hunter = byRole(s, 'hunter')[0]!;
      const villager = byRole(s, 'villager')[0]!;
      s = applyTurn(s, { phase: 'night-guard', kind: 'guard-protect', actorTwinId: guard, data: { target: hunter } });
      for (const w of wolves) {
        s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
      }
      s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: { poison_target: hunter } });
      s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
      s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
      expect(s.alive).not.toContain(hunter);          // poison pierces the shield
      expect(s.poisonedThisNight).toContain(hunter);  // counted as poison
      expect(s.pendingHunterShot).toBeUndefined();    // hunter CANNOT shoot
    });

    it('rotates lastGuardTarget and forbids guarding the same player next night', () => {
      let s = n1();
      const guard = byRole(s, 'guard')[0]!;
      const witch = byRole(s, 'witch')[0]!;
      const seer = byRole(s, 'seer')[0]!;
      const wolves = byRole(s, 'werewolf');
      const villager = byRole(s, 'villager')[0]!;
      const villagerB = byRole(s, 'villager')[1]!;
      // N1: guard protects villager.
      s = applyTurn(s, { phase: 'night-guard', kind: 'guard-protect', actorTwinId: guard, data: { target: villager } });
      for (const w of wolves) {
        s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villagerB } });
      }
      s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
      s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
      s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
      expect(s.lastGuardTarget).toBe(villager);
      // Fast-forward to N2 night-guard (skip the whole day).
      s = skipSheriffElection(s);
      while (s.phase === 'day-direction') s = applyTurn(s, { phase: 'day-direction', kind: 'system', actorTwinId: null }); // no sheriff → skip (added in Unit 2; harmless if phase never appears)
      while (s.phase === 'day-speak') s = applyTurn(s, { phase: 'day-speak', kind: 'speak', actorTwinId: s.alive[s.speechCursor ?? s.cursor], text: 'x' });
      while (s.phase === 'day-vote') s = applyTurn(s, { phase: 'day-vote', kind: 'vote', actorTwinId: s.alive[s.cursor], data: { target: wolves[0] } });
      if (s.phase === 'last-words') s = applyTurn(s, { phase: 'last-words', kind: 'last-words', actorTwinId: s.lastWordsQueue[0], text: 'bye' });
      expect(s.phase).toBe('night-guard');
      // N2: try to re-guard the same villager → 违规按空守.
      s = applyTurn(s, { phase: 'night-guard', kind: 'guard-protect', actorTwinId: guard, data: { target: villager } });
      expect(s.guardTargetThisNight).toBeUndefined();
    });
  });
  ```
  > NOTE for the worker: the `day-direction`/`speechCursor` references in the last test are forward-references to Unit 2. If you implement Unit 1 strictly before Unit 2, simplify that test's day fast-forward to use the current `s.cursor`/`day-speak` loop and drop the `day-direction` line; re-add the directional drive after Unit 2 lands. Mark it clearly so it is not lost.
- [ ] Run it — expect FAIL: the 奶穿 test fails because the current gate `if (pendingWolfKill && !witchSaveUsedTonight)` makes save *cancel* the kill, so the hunter survives.
      Expected message (奶穿 case): `expected [ ...hunter... ] not to contain twin_X` / `expected undefined to be twin_X` (no pendingHunterShot).
- [ ] Rewrite `applyNightResolve` (replace lines ~430-484). Keep dedup, logging, hunter-shoot queueing, and `transitionAfterResolve` exactly as-is; only change the death-computation front:
  ```ts
  function applyNightResolve(s: WerewolfState): WerewolfState {
    const next = clone(s);
    const deaths: Id<'twins'>[] = [];

    // 3-input wolf-kill gate (spec §3):
    //   guarded = guard protected the knife target
    //   saved   = witch used save on the knife target
    //   killed  = pendingWolfKill && !(guarded XOR saved)
    // i.e. exactly ONE of {guard, save} protects; BOTH (奶穿) or NEITHER → dies,
    // and the death is attributed to 狼刀 (NOT poison) so the hunter may shoot.
    const knife = next.pendingWolfKill;
    if (knife) {
      const guarded = next.guardTargetThisNight === knife;
      const saved = next.witchSaveUsedTonight; // save only ever targets the knife
      const killed = !(guarded !== saved); // !(XOR) → both or neither
      if (killed) deaths.push(knife);
    }

    // Witch poison — unconditional kill, pierces the guard shield, counts as 毒.
    if (next.pendingPoisonTarget) {
      deaths.push(next.pendingPoisonTarget);
      next.poisonedThisNight.push(next.pendingPoisonTarget);
    }

    // Dedup (a 奶穿 victim who is ALSO poisoned should count once; poison wins
    // the cause label because it was pushed into poisonedThisNight above).
    const seen = new Set<string>();
    const uniqDeaths: Id<'twins'>[] = [];
    for (const d of deaths) {
      const k = asKey(d);
      if (!seen.has(k)) {
        seen.add(k);
        uniqDeaths.push(d);
      }
    }

    // Apply: remove from alive, log, queue hunter-shoot if applicable.
    for (const d of uniqDeaths) {
      next.alive = next.alive.filter((id) => id !== d);
      next.publicLog.push(
        `Day ${next.day + 1}: ${d} was found dead in the night.`,
      );
      if (next.roles[asKey(d)] === 'hunter') {
        const poisoned = next.poisonedThisNight.includes(d);
        if (!poisoned && !next.pendingHunterShot) {
          next.pendingHunterShot = d;
          next.phaseAfterHunterShot = 'day-speak';
        }
      }
    }

    if (uniqDeaths.length === 0) {
      next.publicLog.push(
        `Day ${next.day + 1}: The village wakes unharmed; no one died.`,
      );
    }

    next.pendingWolfKill = undefined;
    next.pendingPoisonTarget = undefined;
    next.witchSaveUsedTonight = false;
    // Rotate guard memory: this night's protect becomes last night's; clear current.
    next.lastGuardTarget = next.guardTargetThisNight;
    next.guardTargetThisNight = undefined;
    next.nightDeaths = uniqDeaths;
    return transitionAfterResolve(next, true);
  }
  ```
  > Detail: `killed = !(guarded !== saved)` is `!(guarded XOR saved)` — true when both true (奶穿) or both false (no protection). The `saved` flag is only ever set when the witch saved the knife target (the witch save action in the existing code only fires when `pendingWolfKill` exists and is not a self-save violation; it never targets anyone else), so `saved` is safe to read directly.
- [ ] Run it — expect PASS for the whole 3-input describe block.
- [ ] Run the full file — expect the existing witch-save test (`witch save blocks wolf kill`) still PASSES: 守=false, 救=true → XOR true → not killed → seer survives. Good.
- [ ] Typecheck.
- [ ] Commit: `feat(werewolf): rewrite night resolve as 3-input gate (奶穿 dies+shootable, 毒穿盾 dies+blocked)`

---

## Unit 2 — 发言顺序(死左/死右) + speechOrder/speechCursor + 夜死警长黄昏决策 + 遗言不对称

> Medium risk: changes the day-speak cursor model and threads a new `day-direction` phase + `sheriff-night-badge` phase. Touches the hunter return path.

### Task 2.1 — 首夜夜死遗言 (only `day === 0`) + night-2 EMPTY queue assertion

> Currently night deaths get NO last-words at all (only lynch does). Spec §5: add first-night last-words; later nights stay empty.

**Files:**
- Modify `convex/ours/interactions/werewolf/rules.ts` (`applyNightResolve` — inside the `for (const d of uniqDeaths)` loop, before/after hunter handling)
- Test: `convex/tests/werewolf-rules.test.ts`

- [ ] Write failing test — N1 death enters `lastWordsQueue`; N2 death does NOT:
  ```ts
  describe('werewolf rules — 遗言不对称 (first-night only)', () => {
    it('first-night (day===0) night-death gets last-words', () => {
      let s = advanceToWerewolf(initialState(nine, 42));
      const wolves = byRole(s, 'werewolf');
      const witch = byRole(s, 'witch')[0]!;
      const seer = byRole(s, 'seer')[0]!;
      const villager = byRole(s, 'villager')[0]!;
      for (const w of wolves) s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
      s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
      s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
      s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
      expect(s.lastWordsQueue).toContain(villager);
      expect(s.phase).toBe('last-words');
    });

    it('night-2 (day===1) night-death gets NO last-words (off-by-one nailed)', () => {
      // Drive through N1 (kill villagerA, no last-words consumption issues),
      // skip sheriff, run day-1, reach N2, kill villagerB, assert empty queue.
      let s = advanceToWerewolf(initialState(nine, 42));
      const wolves = byRole(s, 'werewolf');
      const witch = byRole(s, 'witch')[0]!;
      const seer = byRole(s, 'seer')[0]!;
      const vA = byRole(s, 'villager')[0]!;
      const vB = byRole(s, 'villager')[1]!;
      for (const w of wolves) s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: vA } });
      s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
      s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
      s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
      // consume N1 last-words for vA
      if (s.phase === 'last-words') s = applyTurn(s, { phase: 'last-words', kind: 'last-words', actorTwinId: s.lastWordsQueue[0], text: 'bye' });
      s = skipSheriffElection(s);
      // run day-1 (no sheriff → day-direction skips; see Task 2.x). Vote out a wolf.
      while (s.phase === 'day-direction') s = applyTurn(s, { phase: 'day-direction', kind: 'system', actorTwinId: null });
      while (s.phase === 'day-speak') s = applyTurn(s, { phase: 'day-speak', kind: 'speak', actorTwinId: s.alive[s.speechCursor ?? 0], text: 'x' });
      while (s.phase === 'day-vote') s = applyTurn(s, { phase: 'day-vote', kind: 'vote', actorTwinId: s.alive[s.cursor], data: { target: wolves[0] } });
      if (s.phase === 'last-words') s = applyTurn(s, { phase: 'last-words', kind: 'last-words', actorTwinId: s.lastWordsQueue[0], text: 'bye' });
      expect(s.day).toBe(1);
      expect(s.phase).toBe('night-guard');
      // N2 kill vB.
      s = advanceToWerewolf(s);
      const aliveWolves = byRole(s, 'werewolf').filter((w) => s.alive.includes(w));
      for (const w of aliveWolves) s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: vB } });
      s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
      s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: aliveWolves[0] } });
      s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
      expect(s.alive).not.toContain(vB);
      expect(s.lastWordsQueue).toEqual([]); // NO last-words on night 2
    });
  });
  ```
  > The `day-direction`/`speechCursor` lines forward-reference Task 2.2/2.3. If implementing 2.1 in isolation, temporarily drive `day-speak` with `s.cursor` and drop the `day-direction` loop, then restore once 2.2/2.3 land.
- [ ] Run it — expect FAIL on the first test: current `applyNightResolve` never pushes night deaths to `lastWordsQueue`, so `expected [] to contain villager`.
- [ ] Implement — in `applyNightResolve`'s death loop, push first-night deaths to the queue. Add inside the `for (const d of uniqDeaths)` loop, after the hunter block:
  ```ts
  // First-night-only last-words (spec §5). `day` is still 0 here because it
  // only increments on the day→night transition — verified no off-by-one.
  if (next.day === 0) {
    next.lastWordsQueue.push(d);
  }
  ```
- [ ] Run it — expect PASS for both tests.
- [ ] Typecheck.
- [ ] Commit: `feat(werewolf): first-night night-deaths get last-words (asymmetric, day===0 gate)`

### Task 2.2 — `day-direction` phase: sheriff picks 死左/死右 or 警左/警右; engine fallback when no sheriff; snapshot speechOrder

**Files:**
- Modify `convex/ours/interactions/werewolf/state.ts` (already added `speechOrder`/`speechCursor`/`speechDirection` in Task 1.3)
- Modify `convex/ours/interactions/werewolf/rules.ts` (`transitionAfterResolve` morning branch ~205-214; new `day-direction` branch in `planNextTurn`; new `day-direction` handler in `applyTurn`; a `computeSpeechOrder` helper)
- Modify `convex/ours/interactions/werewolf/prompts.ts` (new `day-direction` user-prompt branch + `parseTurnText` for `day-direction`)
- Test: `convex/tests/werewolf-rules.test.ts`

- [ ] Add a `computeSpeechOrder` helper to `rules.ts` (above `transitionAfterResolve`). It builds a seat-ordered list of alive players starting from an anchor, walking left or right. Anchor = the single night death's seat (死左/死右) when exactly one died, else seat 0 (警左/警右 / fallback). `direction` defaults to `'right'`:
  ```ts
  function computeSpeechOrder(
    s: WerewolfState,
    anchorSeat: number,
    direction: 'left' | 'right',
  ): Id<'twins'>[] {
    const n = s.participants.length;
    const order: Id<'twins'>[] = [];
    const step = direction === 'right' ? 1 : -1;
    // Start at the seat AFTER the anchor in the chosen direction, walk the full
    // ring, collecting only still-alive seats (dead anchor is skipped naturally).
    for (let k = 1; k <= n; k++) {
      const seat = ((anchorSeat + step * k) % n + n) % n;
      const id = s.participants[seat]!;
      if (s.alive.includes(id)) order.push(id);
    }
    return order;
  }
  ```
- [ ] In `transitionAfterResolve`'s morning branch (the `if (fromNightResolve)` block ~205-214), after sheriff election is done route through `day-direction` instead of straight to `day-speak`. Replace:
  ```ts
  if (fromNightResolve) {
    if (!next.sheriffElectionDone) {
      next.phase = 'sheriff-claim';
      next.sheriffClaimCursor = 0;
      next.cursor = 0;
      return next;
    }
    next.phase = 'day-direction';
    next.speechCursor = 0;
    next.cursor = 0;
  }
  ```
  > IMPORTANT: the day-1 path reaches `day-direction` via the sheriff-election applyTurn handlers, NOT via `transitionAfterResolve`. So you must ALSO change every `next.phase = 'day-speak'; next.cursor = 0;` inside the sheriff-claim / sheriff-vote / sheriff fallback handlers (~756, ~765, ~777, ~849, ~860, ~887, ~915) to `next.phase = 'day-direction';`. Add `next.speechCursor = 0;` alongside. Use a shared inline helper or just repeat — match the file's existing repetitive style. Self-explode skips the day entirely so it does NOT route here.
- [ ] Add the `day-direction` branch to `planNextTurn` (after `sheriff-pull-vote`, before `hunter-shoot`). Mirror the `sheriff-pull-vote` no-sheriff skip:
  ```ts
  if (s.phase === 'day-direction') {
    if (!s.sheriff || !s.alive.includes(s.sheriff)) {
      return { phase: 'day-direction', kind: 'system', actorTwinId: null, visibility: 'public', systemText: 'No sheriff — engine sets speech order.' };
    }
    return { phase: 'day-direction', kind: 'day-direction', actorTwinId: s.sheriff, visibility: 'public' };
  }
  ```
- [ ] Add the `day-direction` handler to `applyTurn` (before the `day-speak` handler ~929). It computes the anchor + direction, snapshots `speechOrder`, resets `speechCursor`, and moves to `day-speak`:
  ```ts
  if (s.phase === 'day-direction' && (t.kind === 'day-direction' || t.kind === 'system' || t.kind === 'abstain')) {
    const next = clone(s);
    const oneDied = next.nightDeaths.length === 1;
    // Anchor: the lone victim's seat when exactly one died (死左/死右);
    // otherwise seat 0 (警左/警右 with a sheriff, or pure fallback without).
    let anchorSeat = 0;
    if (oneDied) {
      anchorSeat = next.participants.indexOf(next.nightDeaths[0]!);
    }
    // Direction: sheriff's explicit choice, else engine default 'right'
    // (死右 ≡ next seat after the victim; 平安夜/双死 ≡ from seat 0 forward).
    let direction: 'left' | 'right' = 'right';
    if (t.kind === 'day-direction') {
      const dec = (t.data as { direction?: string } | undefined)?.direction;
      if (dec === 'left') direction = 'left';
      else direction = 'right';
    }
    next.speechDirection = direction;
    next.speechOrder = computeSpeechOrder(next, anchorSeat, direction);
    next.speechCursor = 0;
    next.phase = 'day-speak';
    return next;
  }
  ```
  > 死左/死右 vs 警左/警右 distinction (spec §4): when exactly ONE died, the anchor is the victim seat (so the order is "from the victim's left/right neighbor"). When 0 died (平安夜) or ≥2 died, the anchor is seat 0 with a sheriff (警左/警右) or pure fallback without — the same `computeSpeechOrder(anchorSeat=0, direction)` covers both because the prompt simply offers the sheriff 警左/警右 wording in that case (handled in the prompt branch).
- [ ] Add the `day-direction` user-prompt branch to `prompts.ts` `buildUserPrompt` (place near the sheriff-pull-vote branch). Offer 死左/死右 when one died, else 警左/警右:
  ```ts
  if (phase === 'day-direction' && kind === 'day-direction') {
    const oneDied = state.nightDeaths.length === 1;
    const victim = oneDied ? (nameMap[state.nightDeaths[0]! as unknown as string] ?? state.nightDeaths[0]) : null;
    const choiceText = oneDied
      ? `昨夜 ${victim} 出局。请选择发言方向：**死左** (从死者左侧顺位起) 或 **死右** (从死者右侧顺位起)。`
      : `昨夜${state.nightDeaths.length === 0 ? '平安无事' : '多人出局'}。请选择发言方向：**警左** 或 **警右** (从你的位置起)。`;
    return `It is day ${state.day + 1}. 你是警长，请决定今天的发言顺序方向。

${choiceText}

PUBLIC LOG:
${renderPublicLog(state.publicLog.slice(-8), nameMap)}

Respond JSON: {"thinking":"...","say":"<one sentence>","action":{"direction":"left" | "right"}}`;
  }
  ```
  > Map 死左/警左 → `"left"`, 死右/警右 → `"right"` (left/right are relative to seat index decreasing/increasing — consistent with `computeSpeechOrder`'s `step`).
- [ ] Add `day-direction` to `parseTurnText` (near the other vote-family branches):
  ```ts
  if (kind === 'day-direction') {
    const direction = action?.direction === 'left' ? 'left' : 'right';
    return { ok: true, data: { thinking, say, direction } };
  }
  ```
- [ ] Write failing tests:
  ```ts
  describe('werewolf rules — day-direction (发言顺序)', () => {
    it('no sheriff → engine skips, snapshots speechOrder, lands on day-speak', () => {
      let s = advanceToWerewolf(initialState(nine, 42));
      const wolves = byRole(s, 'werewolf');
      const witch = byRole(s, 'witch')[0]!;
      const seer = byRole(s, 'seer')[0]!;
      const villager = byRole(s, 'villager')[0]!;
      for (const w of wolves) s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
      s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
      s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
      s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
      if (s.phase === 'last-words') s = applyTurn(s, { phase: 'last-words', kind: 'last-words', actorTwinId: s.lastWordsQueue[0], text: 'bye' });
      s = skipSheriffElection(s);
      expect(s.phase).toBe('day-direction');
      const plan = planNextTurn(s)!;
      expect(plan.kind).toBe('system'); // no sheriff
      s = applyTurn(s, { phase: 'day-direction', kind: 'system', actorTwinId: null });
      expect(s.phase).toBe('day-speak');
      expect(s.speechOrder).toBeDefined();
      expect(s.speechOrder!.every((id) => s.alive.includes(id))).toBe(true);
      expect(s.speechOrder!.length).toBe(s.alive.length);
      expect(s.speechCursor).toBe(0);
    });

    it('exactly one death + sheriff chooses 死右 → order starts at victim+1 seat', () => {
      // Build a sheriff via single-candidate auto-election, then drive to a day with one night-death.
      // (Set up a sheriff on day 1; on day 2 morning the sheriff picks direction.)
      // ... see Task 2.4 for the full sheriff path; assert speechOrder[0] is the
      // alive player seated immediately clockwise from the victim.
    });

    it('平安夜 (0 deaths) → 警左/警右 fallback from seat 0', () => {
      // guard+save fully protect the knife so nobody dies; assert anchorSeat path = seat 0.
    });
  });
  ```
- [ ] Run it — expect FAIL: `expected 'day-speak' to be 'day-direction'` (transition not yet routed) then the order assertions.
- [ ] Implement all the rules/prompt changes above.
- [ ] Run it — expect PASS.
- [ ] Typecheck.
- [ ] Commit: `feat(werewolf): day-direction phase (死左/死右·警左/警右, no-sheriff engine fallback) + speechOrder snapshot`

### Task 2.3 — `day-speak` advances by `speechOrder`/`speechCursor` (skip dead), hunter return path

**Files:**
- Modify `convex/ours/interactions/werewolf/rules.ts` (`planNextTurn` day-speak branch ~378-382; `applyTurn` day-speak handler ~929-943; hunter-shoot return ~687-690)
- Modify `convex/ours/interactions/werewolf/prompts.ts` (`focusHints` first-speaker check uses `state.cursor` ~299 — switch to `speechCursor`)
- Test: `convex/tests/werewolf-rules.test.ts`

- [ ] Write failing test — day-speak walks `speechOrder`, skipping anyone who dies mid-day (hunter shot), via `speechCursor`:
  ```ts
  it('day-speak advances by speechOrder via speechCursor, skipping dead', () => {
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const witch = byRole(s, 'witch')[0]!;
    const seer = byRole(s, 'seer')[0]!;
    const villager = byRole(s, 'villager')[0]!;
    for (const w of wolves) s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: villager } });
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: wolves[0] } });
    s = applyTurn(s, { phase: 'night-resolve', kind: 'system', actorTwinId: null });
    if (s.phase === 'last-words') s = applyTurn(s, { phase: 'last-words', kind: 'last-words', actorTwinId: s.lastWordsQueue[0], text: 'bye' });
    s = skipSheriffElection(s);
    s = applyTurn(s, { phase: 'day-direction', kind: 'system', actorTwinId: null });
    expect(s.phase).toBe('day-speak');
    const order = s.speechOrder!.slice();
    // First planned speaker == speechOrder[0].
    expect(planNextTurn(s)!.actorTwinId).toBe(order[0]);
    let i = 0;
    while (s.phase === 'day-speak') {
      const expected = order[s.speechCursor!]!;
      expect(planNextTurn(s)!.actorTwinId).toBe(expected);
      s = applyTurn(s, { phase: 'day-speak', kind: 'speak', actorTwinId: expected, text: 'x' });
      i++;
    }
    expect(i).toBe(order.length); // every alive player spoke exactly once
    // No sheriff → straight to day-vote.
    expect(s.phase).toBe('day-vote');
  });
  ```
- [ ] Run it — expect FAIL: day-speak still uses `s.cursor`/`s.alive[cursor]`, so `planNextTurn` returns `s.alive[0]` not `order[0]`.
- [ ] Change the `day-speak` branch in `planNextTurn`:
  ```ts
  if (s.phase === 'day-speak') {
    const order = s.speechOrder ?? s.alive;
    const cursor = s.speechCursor ?? 0;
    // Skip anyone in the order who is no longer alive (died mid-day via hunter).
    let i = cursor;
    while (i < order.length && !s.alive.includes(order[i]!)) i++;
    const actor = order[i];
    if (!actor) return null;
    return { phase: 'day-speak', kind: 'speak', actorTwinId: actor, visibility: 'public' };
  }
  ```
- [ ] Change the `day-speak` handler in `applyTurn`. Advance `speechCursor` past dead players; the day ends when the cursor walks off the order:
  ```ts
  if (s.phase === 'day-speak' && (t.kind === 'speak' || t.kind === 'abstain')) {
    const next = clone(s);
    const order = next.speechOrder ?? next.alive;
    let cursor = (next.speechCursor ?? 0) + 1;
    while (cursor < order.length && !next.alive.includes(order[cursor]!)) cursor++;
    next.speechCursor = cursor;
    if (cursor >= order.length) {
      if (next.sheriff && next.alive.includes(next.sheriff)) {
        next.phase = 'sheriff-pull-vote';
      } else {
        next.phase = 'day-vote';
        next.cursor = 0;
      }
    }
    return next;
  }
  ```
  > Keep the day-VOTE cursor model untouched — `day-vote` still iterates `s.alive` via `s.cursor`. Only speech moves to `speechOrder`/`speechCursor`.
- [ ] Fix the hunter-shoot night-death return path. When a night-dead hunter shoots and returns to `day-speak`, the day has not yet computed `speechOrder`. Route the hunter-shoot return through `day-direction` instead of `day-speak` so the order is computed once. Change `phaseAfterHunterShot = 'day-speak'` to a new sentinel and the hunter-shoot return:
  - In `state.ts`, widen `phaseAfterHunterShot?: 'day-speak' | 'day-direction' | 'night-werewolf' | 'night-guard';` (the night branch should target `night-guard` now too).
  - In `applyNightResolve`'s hunter block, set `next.phaseAfterHunterShot = 'day-direction';`.
  - In the hunter-shoot handler (~687-690), return to the recorded phase. Replace the `transitionAfterResolve(next, returnTo === 'day-speak')` call with explicit routing:
    ```ts
    const returnTo = next.phaseAfterHunterShot ?? 'day-direction';
    next.pendingHunterShot = undefined;
    next.phaseAfterHunterShot = undefined;
    if (returnTo === 'night-werewolf' || returnTo === 'night-guard') {
      // Day-lynch hunter death → advance to next night.
      return transitionAfterResolve(next, false);
    }
    // Night-death hunter → go compute speech order for the day, then speak.
    next.phase = 'day-direction';
    return next;
    ```
    > Also update the day-lynch path in `applyDayResolve` (~523) which sets `phaseAfterHunterShot = 'night-werewolf'` — leave it as `'night-werewolf'`; `transitionAfterResolve(next, false)` then resets to `night-guard` correctly.
    > NOTE: with this, a night-dead hunter who shoots reaches `day-direction` AFTER sheriff election? No — on day 1 the sheriff election runs first, and the hunter-shot for a night death happens before sheriff election in `transitionAfterResolve` (hunter-shoot is checked before the morning branch). So returning to `day-direction` would skip sheriff election on day 1. GUARD against this: in the hunter-shoot return, if `!next.sheriffElectionDone`, route to `sheriff-claim` instead:
    ```ts
    if (!next.sheriffElectionDone) {
      next.phase = 'sheriff-claim';
      next.sheriffClaimCursor = 0;
      next.cursor = 0;
      return next;
    }
    next.phase = 'day-direction';
    return next;
    ```
- [ ] Update `prompts.ts` `focusHints` first-speaker detection (~299): change `state.cursor === 0` to `(state.speechCursor ?? 0) === 0`.
- [ ] Update the existing day-speak driver loops in OTHER tests. Many tests do `applyTurn(... actorTwinId: s.alive[s.cursor] ...)` for day-speak. Change those to `s.alive[s.speechCursor ?? 0]` OR (cleaner) drive by `planNextTurn(s)!.actorTwinId`. Walk every `phase: 'day-speak'` driver in the file and switch to `planNextTurn`-driven actors so seat changes don't break them:
  ```ts
  while (s.phase === 'day-speak') {
    const actor = planNextTurn(s)!.actorTwinId!;
    s = applyTurn(s, { phase: 'day-speak', kind: 'speak', actorTwinId: actor, text: 'x' });
  }
  ```
- [ ] Run it — expect PASS for the new test AND all retrofitted day-speak tests.
- [ ] Typecheck.
- [ ] Commit: `feat(werewolf): day-speak follows speechOrder via speechCursor (skips dead); hunter night-death returns via day-direction`

### Task 2.4 — `sheriff-night-badge`: night-dead sheriff transfers/destroys badge (no last-words)

> Spec §5: a night-killed sheriff gets a dusk badge decision (传/撕), but NO last-words. Must clear/transfer `sheriff` + `sheriffHas1_5x` so no dangling id remains.

**Files:**
- Modify `convex/ours/interactions/werewolf/rules.ts` (`applyNightResolve` — detect night-dead sheriff and queue the badge phase; new `sheriff-night-badge` branch in `planNextTurn`; new handler in `applyTurn`; `transitionAfterResolve` must route into it)
- Modify `convex/ours/interactions/werewolf/prompts.ts` (new user-prompt branch + parseTurnText)
- Test: `convex/tests/werewolf-rules.test.ts`

- [ ] Decide the routing. `applyNightResolve` removes the sheriff from `alive` but the badge decision needs an explicit turn. Add a state flag `pendingSheriffBadge?: Id<'twins'>` (add to `state.ts`, `clone`, and clear it on reset like the others — it is set transiently and consumed same morning). In `applyNightResolve`, after the death loop:
  ```ts
  // Night-killed sheriff: queue a dusk badge decision (NO last-words). Spec §5.
  if (next.sheriff && !next.alive.includes(next.sheriff)) {
    next.pendingSheriffBadge = next.sheriff;
  }
  ```
- [ ] In `transitionAfterResolve`, check `pendingSheriffBadge` BEFORE the morning sheriff-election/day-direction branch (and after hunter-shoot/last-words, so badge transfer happens once the queues drain). Add near the top of the function after the `lastWordsQueue` check:
  ```ts
  if (next.pendingSheriffBadge) {
    next.phase = 'sheriff-night-badge';
    return next;
  }
  ```
  > Order matters: hunter-shoot and last-words (first-night) must process first; the badge decision is the dusk step. Place the `pendingSheriffBadge` check AFTER the `lastWordsQueue.length > 0` check so first-night last-words still run first. The returning-from-last-words `transitionAfterResolve(next, false)` call will then re-enter and catch `pendingSheriffBadge`.
- [ ] Add the `sheriff-night-badge` branch to `planNextTurn`:
  ```ts
  if (s.phase === 'sheriff-night-badge') {
    const dead = s.pendingSheriffBadge;
    if (!dead) {
      return { phase: 'sheriff-night-badge', kind: 'system', actorTwinId: null, visibility: 'public', systemText: 'No sheriff badge pending.' };
    }
    return { phase: 'sheriff-night-badge', kind: 'sheriff-night-badge', actorTwinId: dead, visibility: 'public' };
  }
  ```
  > The dead sheriff is NOT in `alive`, but they still get this one decision turn (the framework allows a turn for a non-alive actor here — mirror how last-words operates on a dying player).
- [ ] Add the handler to `applyTurn`. Reuse the badge logic from the last-words sheriff path (~698-733). Clear `pendingSheriffBadge` and `sheriff`/`sheriffHas1_5x` exactly once:
  ```ts
  if (s.phase === 'sheriff-night-badge' && (t.kind === 'sheriff-night-badge' || t.kind === 'system' || t.kind === 'abstain')) {
    const next = clone(s);
    const dead = next.pendingSheriffBadge;
    const data = t.data as { badge_decision?: string } | undefined;
    const dec = data?.badge_decision;
    if (dec && dec.startsWith('pass:')) {
      const passToId = dec.slice('pass:'.length).trim();
      const target = passToId as unknown as Id<'twins'>;
      if (next.alive.includes(target)) {
        next.sheriff = target;
        next.sheriffHas1_5x = true; // inheritor gets both (matches day path)
        next.publicLog.push(`Day ${next.day + 1}: ${dead} (夜死警长) passed the badge to ${target}.`);
      } else {
        next.sheriff = undefined;
        next.sheriffHas1_5x = false;
        next.publicLog.push(`Day ${next.day + 1}: ${dead} (夜死警长) destroyed the badge (invalid target).`);
      }
    } else {
      next.sheriff = undefined;
      next.sheriffHas1_5x = false;
      next.publicLog.push(`Day ${next.day + 1}: ${dead} (夜死警长) destroyed the badge.`);
    }
    next.pendingSheriffBadge = undefined;
    return transitionAfterResolve(next, true); // continue to morning (sheriff-claim already done on day≥1)
  }
  ```
  > A night-dead sheriff only exists on day ≥ 1 (sheriff is elected day-1 morning), so `transitionAfterResolve(next, true)` lands on `day-direction` (election already done). Good — but note `pendingSheriffBadge` is now undefined so it won't loop.
- [ ] Add the user-prompt branch in `prompts.ts` (reuse the last-words badge wording, minus the speech):
  ```ts
  if (phase === 'sheriff-night-badge' && kind === 'sheriff-night-badge') {
    const aliveCands = state.alive;
    return `你（警长）昨夜被杀。你不发表遗言，但仍可处置警徽。
  - 传给某玩家: action.badge_decision = "pass:<twin_id>"（继承归票权 + 1.5 票）
  - 撕毁: action.badge_decision = "destroy"
若不指定，默认撕毁。

可传给的活人候选：
${listCandidates(aliveCands, nameMap)}

Respond JSON: {"thinking":"...","action":{"badge_decision":"pass:<id>" or "destroy"}}`;
  }
  ```
- [ ] Add to `parseTurnText`:
  ```ts
  if (kind === 'sheriff-night-badge') {
    const badgeDec = action && typeof action.badge_decision === 'string' ? action.badge_decision : undefined;
    return { ok: true, data: { thinking, badge_decision: badgeDec } };
  }
  ```
- [ ] Write failing tests (set up a sheriff on day 1, kill them at night, assert badge handling + no last-words):
  ```ts
  describe('werewolf rules — night-dead sheriff badge (黄昏决策, no last-words)', () => {
    // Helper drives a 9p game to a day-1 sheriff, then to night-2 where wolves kill the sheriff.
    function gameWithSheriffKilledNight2(passTo?: 'heir' | 'destroy') { /* ... */ }

    it('night-killed sheriff transfers badge, gets NO last-words, no dangling sheriff id', () => {
      // ... drive to sheriff-night-badge, apply pass:<alive heir>
      // expect(s.phase).toBe('sheriff-night-badge');
      // s = applyTurn(s, { phase:'sheriff-night-badge', kind:'sheriff-night-badge', actorTwinId: deadSheriff, data:{ badge_decision:`pass:${heir}` }});
      // expect(s.sheriff).toBe(heir);
      // expect(s.sheriffHas1_5x).toBe(true);
      // expect(s.lastWordsQueue).not.toContain(deadSheriff); // no last-words on night 2
      // expect(s.alive).not.toContain(deadSheriff);
    });

    it('night-killed sheriff defaults to destroy when decision omitted; sheriff becomes undefined', () => {
      // s = applyTurn(s, { phase:'sheriff-night-badge', kind:'sheriff-night-badge', actorTwinId: deadSheriff, data:{} });
      // expect(s.sheriff).toBeUndefined();
      // expect(s.sheriffHas1_5x).toBe(false);
    });
  });
  ```
  > Write the full `gameWithSheriffKilledNight2` driver mirroring the existing `nightOneToSheriffClaim` helper: night-1 (advanceToWerewolf → kill a villager → witch → seer → resolve → consume N1 last-words) → elect a single-candidate sheriff → day-direction(system) → day-speak(planNextTurn-driven) → sheriff-pull-vote → day-vote (lynch a wolf, NOT the sheriff) → night-2 → wolves kill the sheriff → witch skip → seer → resolve → land on sheriff-night-badge.
- [ ] Run it — expect FAIL: no `sheriff-night-badge` phase exists; the night-dead sheriff's id dangles in `state.sheriff` and `planNextTurn`/`day-direction` would read a dead sheriff.
- [ ] Implement all the above.
- [ ] Run it — expect PASS.
- [ ] Typecheck.
- [ ] Commit: `feat(werewolf): night-dead sheriff dusk badge decision (传/撕, no last-words, clears dangling id)`

---

## Unit 3 — 白天平票 PK (day-pk-speech / day-pk-vote)

> Low-medium: mirror the existing sheriff-PK state-machine pattern (`dayPkCandidates`/`dayPkVotes`/`dayPkActive`, already added to state in Task 1.3).

### Task 3.1 — `day-vote` tie enters `day-pk-speech`; 台下 revote excludes PK candidates; double-tie → 平安日

**Files:**
- Modify `convex/ours/interactions/werewolf/rules.ts` (`applyDayResolve` ~486-535 — detect tie, enter PK; new `day-pk-speech`/`day-pk-vote` branches in `planNextTurn`; new handlers in `applyTurn`)
- Modify `convex/ours/interactions/werewolf/prompts.ts` (user-prompt branches + parseTurnText)
- Test: `convex/tests/werewolf-rules.test.ts`

- [ ] Rework `applyDayResolve` so a tie (`winner && tied` OR specifically `≥2 leaders`) enters PK instead of deadlocking. Currently `tied` is a loose boolean; compute a proper leaders set. Replace the tally/winner block:
  ```ts
  let max = 0;
  const leaders: string[] = [];
  for (const [target, n] of Object.entries(tally)) {
    if (n > max) { max = n; leaders.length = 0; leaders.push(target); }
    else if (n === max) { leaders.push(target); }
  }
  next.pendingVotes = {};

  if (leaders.length === 1 && max > 0) {
    const lynched = leaders[0] as unknown as Id<'twins'>;
    next.alive = next.alive.filter((id) => id !== lynched);
    next.publicLog.push(`Day ${next.day + 1}: The village voted to lynch ${leaders[0]}.`);
    next.lastWordsQueue.push(lynched);
    if (next.roles[asKey(lynched)] === 'hunter') {
      next.pendingHunterShot = lynched;
      next.phaseAfterHunterShot = 'night-werewolf';
    }
    return transitionAfterResolve(next, false);
  }

  if (leaders.length >= 2 && max > 0 && !next.dayPkActive) {
    // First daytime tie → PK round. Tied candidates re-speak, then 台下 revote.
    const pkSet: Id<'twins'>[] = [];
    for (const id of next.alive) {
      if (leaders.includes(asKey(id))) pkSet.push(id);
    }
    next.dayPkCandidates = pkSet;
    next.dayPkVotes = {};
    next.dayPkActive = true;
    next.speechCursor = 0; // reuse a cursor index over dayPkCandidates for PK speech
    next.publicLog.push(`Day ${next.day + 1}: 白天投票平票 (${leaders.length} tied) — 进入 PK 加赛。`);
    next.phase = 'day-pk-speech';
    return next;
  }

  // No votes, or already in PK and STILL tied → 平安日 (reuse deadlock branch).
  next.publicLog.push(`Day ${next.day + 1}: The village deadlocked — no one was lynched.`);
  next.dayPkActive = false;
  next.dayPkCandidates = undefined;
  next.dayPkVotes = undefined;
  return transitionAfterResolve(next, false);
  ```
  > The `dayPkActive` guard ensures a second tie (already in PK) falls through to the 平安日 deadlock branch — exactly the spec's "双平→平安日复用 deadlock 分支".
- [ ] Add the `day-pk-speech` branch to `planNextTurn` (mirror `sheriff-pk-speech` ~335-352, using `dayPkCandidates` + `speechCursor`):
  ```ts
  if (s.phase === 'day-pk-speech') {
    const actor = (s.dayPkCandidates ?? [])[s.speechCursor ?? 0];
    if (!actor) {
      return { phase: 'day-pk-speech', kind: 'system', actorTwinId: null, visibility: 'public', systemText: 'PK speech round complete.' };
    }
    return { phase: 'day-pk-speech', kind: 'day-pk-speech', actorTwinId: actor, visibility: 'public' };
  }
  ```
- [ ] Add the `day-pk-vote` branch to `planNextTurn`. Voters = 台下 = alive minus PK candidates AND not yet voted. (台下 revote, PK 者不投 — spec §6.)
  ```ts
  if (s.phase === 'day-pk-vote') {
    const cands = s.dayPkCandidates ?? [];
    const votes = s.dayPkVotes ?? {};
    const remaining = s.alive.filter((id) => !cands.includes(id) && !votes[asKey(id)]);
    const actor = remaining[0];
    if (!actor) {
      return { phase: 'day-pk-vote', kind: 'system', actorTwinId: null, visibility: 'public', systemText: 'PK vote ends.' };
    }
    return { phase: 'day-pk-vote', kind: 'day-pk-vote', actorTwinId: actor, visibility: 'public' };
  }
  ```
- [ ] Add the `day-pk-speech` handler to `applyTurn` (mirror sheriff-pk-speech ~895-903):
  ```ts
  if (s.phase === 'day-pk-speech' && (t.kind === 'day-pk-speech' || t.kind === 'abstain')) {
    const next = clone(s);
    next.speechCursor = (next.speechCursor ?? 0) + 1;
    if (next.speechCursor >= (next.dayPkCandidates ?? []).length) {
      next.phase = 'day-pk-vote';
    }
    return next;
  }
  ```
- [ ] Add the `day-pk-vote` handler to `applyTurn`. Tally with the 1.5x rule, BUT only if the sheriff is NOT a PK candidate (spec §6: 若警长是 PK 者则其不投，该轮 1.5 票不计). When all 台下 voted, lynch the single leader, else 平安日:
  ```ts
  if (s.phase === 'day-pk-vote' && (t.kind === 'day-pk-vote' || t.kind === 'abstain')) {
    const next = clone(s);
    const cands = next.dayPkCandidates ?? [];
    if (t.actorTwinId) {
      const voterKey = asKey(t.actorTwinId);
      const isElectorate = !cands.includes(t.actorTwinId);
      const votes = next.dayPkVotes ?? {};
      if (isElectorate && !votes[voterKey]) {
        const target = (t.data as { target?: Id<'twins'> })?.target;
        if (t.kind !== 'abstain' && target && cands.includes(target)) {
          votes[voterKey] = asKey(target);
        } else {
          votes[voterKey] = '_abstain';
        }
        next.dayPkVotes = votes;
      }
    }
    const electorate = next.alive.filter((id) => !cands.includes(id));
    const votes = next.dayPkVotes ?? {};
    const allVoted = electorate.every((id) => votes[asKey(id)]);
    if (allVoted) {
      // Tally. Sheriff gets 1.5x ONLY when sheriff is part of the electorate
      // (i.e. NOT a PK candidate) — spec §6.
      const sheriffIsPk = next.sheriff ? cands.includes(next.sheriff) : false;
      const tally: Record<string, number> = {};
      for (const [voterKey, v] of Object.entries(votes)) {
        if (v === '_abstain') continue;
        const weight =
          next.sheriff && asKey(next.sheriff) === voterKey && next.sheriffHas1_5x && !sheriffIsPk
            ? 1.5
            : 1.0;
        tally[v] = (tally[v] || 0) + weight;
      }
      let max = 0;
      const leaders: string[] = [];
      for (const [c, n] of Object.entries(tally)) {
        if (n > max) { max = n; leaders.length = 0; leaders.push(c); }
        else if (n === max) { leaders.push(c); }
      }
      if (leaders.length === 1 && max > 0) {
        const lynched = leaders[0] as unknown as Id<'twins'>;
        next.alive = next.alive.filter((id) => id !== lynched);
        next.publicLog.push(`Day ${next.day + 1}: PK 投票放逐了 ${leaders[0]}.`);
        next.lastWordsQueue.push(lynched);
        if (next.roles[asKey(lynched)] === 'hunter') {
          next.pendingHunterShot = lynched;
          next.phaseAfterHunterShot = 'night-werewolf';
        }
        next.dayPkActive = false;
        next.dayPkCandidates = undefined;
        next.dayPkVotes = undefined;
        return transitionAfterResolve(next, false);
      }
      // PK still tied → 平安日.
      next.publicLog.push(`Day ${next.day + 1}: PK 仍平票 — 平安日，无人出局。`);
      next.dayPkActive = false;
      next.dayPkCandidates = undefined;
      next.dayPkVotes = undefined;
      return transitionAfterResolve(next, false);
    }
    return next;
  }
  ```
- [ ] Add prompt branches in `prompts.ts` for `day-pk-speech` and `day-pk-vote` (mirror `sheriff-pk-speech` / `sheriff-pk-vote` shape, using `state.dayPkCandidates`):
  ```ts
  if (phase === 'day-pk-speech' && kind === 'day-pk-speech') {
    return `Day ${state.day + 1} — 白天平票 PK 加赛发言。你与其他平票者再讲一轮，把台下的票拉向你的对手。

PUBLIC LOG:
${renderPublicLog(state.publicLog.slice(-8), nameMap)}

TIED CANDIDATES:
${listCandidates(state.dayPkCandidates ?? [], nameMap)}${hints}${grounding}

Respond JSON: {"thinking":"...","say":"<your PK speech, 1-2 sentences>"}`;
  }
  if (phase === 'day-pk-vote' && kind === 'day-pk-vote') {
    return `Day ${state.day + 1} — 白天平票 PK 投票。你是台下（非 PK 候选人），从平票者中选一个放逐。再平则今天平安无人出局。

PUBLIC LOG:
${renderPublicLog(state.publicLog.slice(-8), nameMap)}

PK CANDIDATES:
${listCandidates(state.dayPkCandidates ?? [], nameMap)}${hints}${grounding}

Respond JSON: {"thinking":"...","say":"<one sentence>","action":{"target":"<one of the PK candidate ids>"}}`;
  }
  ```
- [ ] Add to `parseTurnText`:
  ```ts
  if (kind === 'day-pk-speech') {
    if (!say) return { ok: false, error: `day-pk-speech requires "say"` };
    return { ok: true, data: { thinking, say } };
  }
  if (kind === 'day-pk-vote') {
    const target = typeof action?.target === 'string' ? action.target : undefined;
    if (!target) return { ok: false, error: `day-pk-vote requires action.target` };
    if (!allowed.includes(target)) return { ok: false, error: `day-pk-vote target "${target}" not in alive set` };
    return { ok: true, data: { thinking, say, target } };
  }
  ```
- [ ] Write failing tests:
  ```ts
  describe('werewolf rules — 白天平票 PK', () => {
    it('day-vote tie enters day-pk-speech with the tied set; 台下 (PK者不投) revote elects one', () => {
      // Drive a no-sheriff 9p day to day-vote, manufacture a 2-way tie between
      // two specific alive players, assert phase===day-pk-speech and
      // dayPkCandidates===[A,B]. Run PK speeches via planNextTurn, then PK vote:
      // assert PK candidates are NOT offered a vote turn (planNextTurn never
      // returns them as actor), 台下 break the tie, the loser is lynched, phase
      // advances to last-words (lynched gets last-words).
    });

    it('double tie → 平安日, no lynch, advances to next night', () => {
      // Tie in round 1 → PK; tie again in PK → deadlock branch; assert
      // dayPkActive===false, dayPkCandidates===undefined, phase===night-guard,
      // day incremented.
    });

    it('1.5x NOT counted when the sheriff is a PK candidate', () => {
      // Elect a sheriff; force a day tie that includes the sheriff as a PK
      // candidate; in PK the sheriff does not vote and their 1.5x must not tip
      // the tally. Assert the non-1.5x leader wins (or 平安日 on true tie).
    });
  });
  ```
  > For the "PK者不投" assertion: iterate `planNextTurn` during `day-pk-vote` and assert `dayPkCandidates` never appears as `actor`. For the tie manufacture, use the no-sheriff path (`skipSheriffElection`) so the 1.5x weight doesn't interfere with the first two tests.
- [ ] Run it — expect FAIL: current `applyDayResolve` only has lynch-or-deadlock; a tie hits the deadlock branch (`expected 'night-guard' to be 'day-pk-speech'`).
- [ ] Implement all the above.
- [ ] Run it — expect PASS.
- [ ] Typecheck.
- [ ] Commit: `feat(werewolf): daytime PK tie-break (day-pk-speech/vote, 台下重投 PK者不投, 双平→平安日, sheriff-1.5x suppressed when PK candidate)`

---

## Unit 4 — 预言家只验阵营 (seerKnowledge stores alignment)

> Low risk: change the stored shape + two render points. Grep already confirmed only `prompts.ts:169` and `:363` consume `seerKnowledge` (plus the test at `werewolf-rules.test.ts:819`). No spectator/debug consumers.

### Task 4.1 — Store `alignment` ('werewolf' | 'good') at peek time; render alignment only

**Files:**
- Modify `convex/ours/interactions/werewolf/state.ts` (`seerKnowledge` field ~141)
- Modify `convex/ours/interactions/werewolf/rules.ts` (peek write ~620-625)
- Modify `convex/ours/interactions/werewolf/prompts.ts` (render at ~166-171 in `groundingFacts`, ~360-366 in `focusHints`)
- Modify `convex/tests/werewolf-rules.test.ts` (the grounding test at ~813-831 that constructs `seerKnowledge` with `role`)
- Test: `convex/tests/werewolf-rules.test.ts`

- [ ] Change the `seerKnowledge` field type in `state.ts`:
  ```ts
  seerKnowledge: Array<{ target: Id<'twins'>; alignment: 'werewolf' | 'good'; day: number }>;
  ```
- [ ] Update the peek write in `rules.ts` (~620-625) to derive alignment from role:
  ```ts
  if (t.kind === 'peek') {
    const target = (t.data as { target?: Id<'twins'> })?.target;
    const role = target ? next.roles[asKey(target)] : undefined;
    if (target && role) {
      const alignment: 'werewolf' | 'good' = role === 'werewolf' ? 'werewolf' : 'good';
      next.seerKnowledge.push({ target, alignment, day: next.day });
    }
  }
  ```
- [ ] Update the render in `groundingFacts` (~166-171):
  ```ts
  const checks = state.seerKnowledge
    .map(
      (k) =>
        `  · Day ${k.day}: ${nameMap[k.target as unknown as string] ?? k.target} = ${k.alignment === 'werewolf' ? '查杀(狼)' : '金水(好人)'}`,
    )
    .join('\n');
  ```
- [ ] Update the render in `focusHints` (~360-366) identically:
  ```ts
  const checks = state.seerKnowledge
    .map(
      (k) =>
        `  · Day ${k.day}: ${nameMap[k.target as unknown as string] ?? k.target} = ${k.alignment === 'werewolf' ? '查杀(狼)' : '金水(好人)'}`,
    )
    .join('\n');
  ```
- [ ] Update the existing grounding test (`werewolf-rules.test.ts:817-819` and its assertion `:829`). Change the constructed object and the assertion:
  ```ts
  s = { ...s, seerKnowledge: [{ target: wolf, alignment: 'werewolf', day: 0 }] };
  // ...
  expect(p).toContain('AliceWolf = 查杀(狼)');
  ```
- [ ] Write a fresh failing test — peeking a witch records `'good'`, never the role string:
  ```ts
  it('seer peek stores alignment only (witch → good, never role)', () => {
    let s = advanceToWerewolf(initialState(nine, 42));
    const wolves = byRole(s, 'werewolf');
    const seer = byRole(s, 'seer')[0]!;
    const witch = byRole(s, 'witch')[0]!;
    for (const w of wolves) s = applyTurn(s, { phase: 'night-werewolf', kind: 'wolf-kill-bid', actorTwinId: w, data: { target: byRole(s, 'villager')[0] } });
    s = applyTurn(s, { phase: 'night-witch', kind: 'witch-act', actorTwinId: witch, data: {} });
    s = applyTurn(s, { phase: 'night-seer', kind: 'peek', actorTwinId: seer, data: { target: witch } });
    expect(s.seerKnowledge[0]!.alignment).toBe('good');
    expect((s.seerKnowledge[0] as Record<string, unknown>).role).toBeUndefined();
    const p = buildUserPrompt({ state: s, actorTwinId: seer, phase: 'last-words', kind: 'last-words', visibleTurns: [], aliveNames: { [witch as unknown as string]: 'WitchName' } });
    expect(p).toContain('WitchName = 金水(好人)');
    expect(p).not.toContain('witch'); // role string must NOT leak
  });
  ```
- [ ] Run it — expect FAIL at typecheck/compile first (the test file's `role`-keyed object no longer matches the field type), then the runtime assertions.
- [ ] Implement all the above.
- [ ] Run it — expect PASS.
- [ ] Typecheck — expect clean (this is where a stray `seerKnowledge.role` consumer would surface).
- [ ] Commit: `feat(werewolf): seer learns alignment only (查杀/金水), store alignment at peek time`

---

## Regression guard

Before final handoff:

- [ ] Existing behaviors that MUST still pass: 自爆 (wolf self-explode), 女巫 save/poison + N1-only self-save, 猎人 shoot-on-lynch + poison-blocked, 白天警徽流 (day-lynch sheriff badge pass/destroy), sheriff election + PK rounds, checkWin 屠边 边界, summarizeFor, all parseTurnText/buildSystemPrompt/buildUserPrompt prompt tests.
- [ ] Run the focused suite: `npx vitest run convex/tests/werewolf-rules.test.ts` — all green.
- [ ] Run the FULL suite: `npx vitest run` — all green (catches cross-module breakage, e.g. anything else importing the werewolf state shape).
- [ ] Typecheck the whole convex project: `npx tsc --noEmit -p convex/tsconfig.json` — clean.
- [ ] Sanity self-check on the high-risk silent-drop bugs:
  - Every new field (`guardTargetThisNight`, `lastGuardTarget`, `speechOrder`, `speechCursor`, `speechDirection`, `dayPkCandidates`, `dayPkVotes`, `dayPkActive`, `pendingSheriffBadge`) is present in `clone()`.
  - Night reset (`transitionAfterResolve` else-branch) and self-explode reset both set `phase = 'night-guard'` and clear `guardTargetThisNight` but PRESERVE `lastGuardTarget`.
  - No dangling `state.sheriff` after a night-dead sheriff (Task 2.4).
  - 奶穿 victim is NOT in `poisonedThisNight`; 毒穿盾 victim IS.

### Out of scope (do NOT implement here)
- 白痴 role; seer 两夜警徽流 verify-strategy convention; 限时发言/积分系统.
- The sheriff-PK losers-revote fix (`rules.ts:313-316`) — that is a separate, orthogonal commit, not part of this plan.
- 12-player game-seeding orchestration (`seedTwinsForGame` producing 12 personas) — verify at integration time; if broken, file separately.
