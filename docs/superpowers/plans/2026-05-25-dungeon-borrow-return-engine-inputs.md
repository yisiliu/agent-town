# Dungeon Borrow/Return via Engine Inputs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the ai-town engine clobbering the dungeon/werewolf borrow/return by routing both through a new `teleportPlayer` engine input, with a staged conversation-aware borrow (finish conversation, 30s force-leave).

**Architecture:** A new fork input `teleportPlayer` (applied inside the engine's `handleInput`→`saveDiff`, so it's never clobbered) replaces all direct `world.players` writes in the interaction system. The borrow becomes a `gathering` phase driven by a self-rescheduling `gatherStep` mutation that pulls each participant in once they're conversation-free; the game flips to `in_progress` only when all are gathered. Return/cancel enqueue restore teleports.

**Tech Stack:** TypeScript, Convex, Vitest + `convex-test`. Spec: `docs/superpowers/specs/2026-05-25-dungeon-borrow-return-engine-inputs-design.md`.

**Critical context:**
- **Fork is generated:** `convex/aiTown/` is `rm -rf`'d and `cp`'d from `ai-town-fork/convex/aiTown/` by `scripts/sync-ai-town.sh`. Engine edits go in **`ai-town-fork/` source**, then run sync. A new file under `ai-town-fork/convex/aiTown/` propagates via the wholesale `cp -r` (no new cp line).
- **`world.players` is engine-owned** (`saveDiff` does `db.replace`); direct patches while live get clobbered. The fix routes through inputs.
- **Verified:** hidden agents can't wander back (`findRoute` fails from off-map → `stopPlayer`), so no engine "borrowed-guard" is needed.
- **Test harness:** `convex/tests/dungeon-bridge.test.ts` uses `convexTest(schema)` + a `seedAiTownWorld(t, n)` helper. Reuse it. `insertInput` from a mutation: precedent `convex/ours/actions/forceEndAllConversations.ts:43-53` (`insertInput(ctx, worldId, 'leaveConversation', {playerId: x as any, conversationId: y as any})`).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `ai-town-fork/convex/aiTown/dungeonInputs.ts` | the `teleportPlayer` input handler | **create** |
| `ai-town-fork/convex/aiTown/inputs.ts` | input registry | add `...dungeonInputs` (1 line) |
| `ai-town-fork/UPSTREAM_FILES.txt` | additivity gate | `# EXEMPT` inputs.ts + allowlist dungeonInputs.ts |
| `convex/aiTown/{inputs,dungeonInputs}.ts` | generated copies | via `scripts/sync-ai-town.sh` |
| `convex/ours/tables/interactions.ts` | schema | + `'gathering'` status, `pendingPlayerIds`, `gatheringStartedAt` |
| `convex/ours/interactions/gather.ts` | pure `nextGatherAction` decision helper | **create** |
| `convex/ours/mutations/gatherStep.ts` | atomic per-tick gather + self-reschedule | **create** |
| `convex/ours/mutations/startDungeonGame.ts` | start in `gathering`, double-borrow guard, drop hide block, kick gather | modify |
| `convex/ours/mutations/appendInteractionTurn.ts` | return via `teleportPlayer` + delete-guard | modify (lines 88-116) |
| `convex/ours/mutations/cancelInteraction.ts` | return via `teleportPlayer` + delete-guard | modify (lines 23-52) |
| `convex/ours/queries/listActiveInteractions.ts` | include `gathering` | modify |
| `convex/ours/crons/interactionTick.ts` | branch: gather vs takeTurn | modify |
| `convex/tests/dungeon-bridge.test.ts` + `convex/tests/gather.test.ts` | tests | modify / create |

---

## Task 1: `teleportPlayer` engine input (fork source + sync)

**Files:** create `ai-town-fork/convex/aiTown/dungeonInputs.ts`; modify `ai-town-fork/convex/aiTown/inputs.ts`, `ai-town-fork/UPSTREAM_FILES.txt`; run sync.

- [ ] **Step 1: Create the handler** `ai-town-fork/convex/aiTown/dungeonInputs.ts` (mirror `playerInputs.moveTo` at player.ts:291, but teleport instead of pathfind):
```ts
import { inputHandler } from './inputHandler';
import { parseGameId, playerId } from './ids';
import { point, vector } from '../util/types';

export const dungeonInputs = {
  teleportPlayer: inputHandler({
    // position is a point {x,y}; facing is a vector {dx,dy} (player.ts:54-55)
    args: { playerId, position: point, facing: vector },
    handler: (game, _now, args) => {
      const id = parseGameId('players', args.playerId);
      const player = game.world.players.get(id);
      if (!player) throw new Error(`Invalid player ID ${id}`);
      player.position = args.position;
      player.facing = args.facing;
      player.pathfinding = undefined;
      player.activity = undefined;
      player.speed = 0;
      return null;
    },
  }),
};
```
(Verify the exact imports for `playerId`/`point` against how `player.ts` imports them — `player.ts:291` uses `playerId` and `point`; match its import sources.)

- [ ] **Step 2: Register it** — in `ai-town-fork/convex/aiTown/inputs.ts`, import `dungeonInputs` and add `...dungeonInputs` to the `inputs` object (and to the module-scope `undefined` cycle-guard at inputs.ts:8 for hygiene).

- [ ] **Step 3: Authorize in the additivity gate** — in `ai-town-fork/UPSTREAM_FILES.txt`: add `# EXEMPT: dungeon teleport input for borrow/return` to the `inputs.ts` line, and add a line authorizing the new `dungeonInputs.ts` (match whatever form the gate expects — read `scripts/check-ai-town-additivity.sh` first to see whether new files go in the `.txt` allowlist).

- [ ] **Step 4: Sync** — run `bash scripts/sync-ai-town.sh`. Confirm `convex/aiTown/dungeonInputs.ts` + the `inputs.ts` change appear in the generated tree.

- [ ] **Step 5: Typecheck + additivity** — `npx tsc --noEmit -p convex` (expect only the known cardValidator/yaml errors); `bash scripts/check-ai-town-additivity.sh` (expect PASS). Confirm `'teleportPlayer'` is now a valid `InputNames` (e.g. a throwaway `insertInput(ctx, w, 'teleportPlayer', {...})` typechecks).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(aitown): teleportPlayer engine input (instant teleport, no pathfinding)"`

---

## Task 2: Schema — `gathering` status + fields

**Files:** `convex/ours/tables/interactions.ts`.

- [ ] **Step 1:** Add `v.literal('gathering')` to the `status` union (alongside `'in_progress'`/`'ended'`; the dead `'lobby'` may stay or be removed — it's never written). Add `pendingPlayerIds: v.optional(v.array(v.string()))` and `gatheringStartedAt: v.optional(v.number())`.
- [ ] **Step 2:** `npx tsc --noEmit -p convex` — expect clean (optional fields are additive/back-compat).
- [ ] **Step 3: Commit** — `git commit -am "feat(interactions): add gathering status + pending fields"`

---

## Task 3: Pure gather-decision helper

**Files:** create `convex/ours/interactions/gather.ts`; create `convex/tests/gather.test.ts`.

- [ ] **Step 1: Write failing tests** (`gather.test.ts`). The helper decides, per pending player, what to do given conversation membership + the 30s deadline:
```ts
import { describe, it, expect } from 'vitest';
import { nextGatherAction } from '../ours/interactions/gather';

const conv = (id: string, pids: string[]) => ({ id, participants: pids.map((p) => ({ playerId: p })) });

it('free player → pull', () => {
  expect(nextGatherAction('p:1', [], 0, 1000)).toEqual({ kind: 'pull' });
});
it('talking & <30s → wait', () => {
  expect(nextGatherAction('p:1', [conv('c:1', ['p:1', 'p:2'])], 0, 10_000)).toEqual({ kind: 'wait' });
});
it('talking & ≥30s → forceLeave with conversationId', () => {
  expect(nextGatherAction('p:1', [conv('c:1', ['p:1', 'p:2'])], 0, 30_000)).toEqual({ kind: 'forceLeave', conversationId: 'c:1' });
});
```
- [ ] **Step 2: Run, confirm FAIL** — `npx vitest run convex/tests/gather.test.ts`.
- [ ] **Step 3: Implement** `convex/ours/interactions/gather.ts`:
```ts
const GATHER_FORCE_MS = 30_000;
type Conv = { id: string; participants: { playerId: string }[] };
export type GatherAction =
  | { kind: 'pull' }
  | { kind: 'wait' }
  | { kind: 'forceLeave'; conversationId: string };
export function nextGatherAction(
  playerId: string, conversations: Conv[], gatheringStartedAt: number, now: number,
): GatherAction {
  const conv = conversations.find((c) => c.participants.some((m) => m.playerId === playerId));
  if (!conv) return { kind: 'pull' };
  if (now - gatheringStartedAt < GATHER_FORCE_MS) return { kind: 'wait' };
  return { kind: 'forceLeave', conversationId: conv.id };
}
```
(Note: the "player missing from `world.players`" case is handled in the mutation, not here — the mutation checks presence before calling this.)
- [ ] **Step 4: Run, confirm PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(gather): pure nextGatherAction decision helper"`

---

## Task 4: `gatherStep` mutation (atomic gather + self-reschedule)

**Files:** create `convex/ours/mutations/gatherStep.ts`; add tests to `dungeon-bridge.test.ts`.

Behavior (one atomic mutation): load interaction (must be `gathering`) + world. For each `pendingPlayerId`: if missing from `world.players` → **cancel** the interaction (restore already-pulled via the Task 7 helper, set ended/cancelled) and stop. Else `nextGatherAction(pid, world.conversations, gatheringStartedAt, now)`: `pull` → insert `dungeonReturnState` snapshot + `insertInput('teleportPlayer', → -9999)` + drop from pending; `wait` → keep; `forceLeave` → `insertInput('leaveConversation', {playerId, conversationId})` **first**, then snapshot + `insertInput('teleportPlayer', → -9999)` + drop from pending. After the loop: patch the (possibly shrunk) `pendingPlayerIds`; if empty → `status:'in_progress'`, `lastTickAt: now` and `scheduler.runAfter(0, interactionTakeTurn, {interactionId, chainCount:0})`; else `scheduler.runAfter(3000, gatherStep, {interactionId})`. Always clear `inflightSince`.

- [ ] **Step 0 (PREREQUISITE — without it every enqueue-assertion throws):** extend `seedAiTownWorld` (dungeon-bridge.test.ts) to also insert an `engines` row and a `worldStatus { worldId, engineId, isDefault: true, ... }`. `insertInput` (insertInput.ts:12-18) looks up `worldStatus` by `worldId` and throws `World for engine … not found` otherwise; it then writes to the queryable `inputs` table via `engineInsertInput`. Seed minimal valid `engines`/`worldStatus` rows (match the schema in `convex/engine/schema.ts` + `convex/ours/tables` / aiTown worldStatus). After this, tests can assert enqueued inputs by querying the `inputs` table.
- [ ] **Step 1: Write failing integration tests** (`dungeon-bridge.test.ts`, reuse the extended `seedAiTownWorld`). Cover: (a) a gathering interaction with all players free → one `gatherStep` enqueues N `teleportPlayer` inputs (assert rows in the `inputs` table with `name:'teleportPlayer'`), creates N `dungeonReturnState` rows, empties `pendingPlayerIds`, flips status to `in_progress`; (b) a player in a seeded conversation stays pending (no teleport for them) while `<30s`; (c) at `≥30s` a `leaveConversation` input is enqueued for them then they're pulled; (d) a `pendingPlayerId` absent from `world.players` → interaction ends with `winner:'cancelled'`. (Seed conversations by adding to `world.conversations` in `seedAiTownWorld` or a variant.)
- [ ] **Step 2: Run, confirm FAIL.**
- [ ] **Step 3: Implement** `gatherStep` (internalMutation). Use `insertInput(ctx, worldId, 'teleportPlayer', {playerId: pid as any, position, facing})` and the `leaveConversation` form from `forceEndAllConversations.ts:46-51`. Snapshot reads `world.players.find(p => p.id === pid)` for position/facing.
- [ ] **Step 4: Run, confirm PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(gather): gatherStep mutation — conversation-aware staged borrow"`

---

## Task 5: `startDungeonGame` → gathering + double-borrow guard

**Files:** `convex/ours/mutations/startDungeonGame.ts`.

- [ ] **Step 1: Write failing tests** (`dungeon-bridge.test.ts`): (a) `startDungeonGame` now inserts `status:'gathering'` with `pendingPlayerIds = playerIds`, `gatheringStartedAt` set, and does NOT immediately move players to `-9999` (assert no player at -9999 right after; they hide only after `gatherStep`); (b) it schedules a `gatherStep`; (c) calling it with a playerId already in another non-ended dungeon interaction's `originPlayerIds`/`pendingPlayerIds` throws (double-borrow guard).
- [ ] **Step 2: Run, confirm FAIL.**
- [ ] **Step 3: Implement** — change the insert to `status:'gathering'`, add `pendingPlayerIds: args.playerIds`, `gatheringStartedAt: now`; **delete lines 75-112** (the hide + snapshot block); after insert, `scheduler.runAfter(0, gatherStep, {interactionId})`.
  - **Double-borrow guard (no `originType` index exists):** run the two indexed status queries (`by_status_and_lastTickAt` with `q.eq('status','gathering')` and `…'in_progress'`), filter `originType==='dungeon'`, and throw if any `args.playerIds` overlaps another row's `originPlayerIds` ∪ `pendingPlayerIds`. (Bounded — same `.take(50)` scope as `listActiveInteractions`.)
  - **Update existing tests that encode the old behavior:** the `expect(inter.status).toBe('in_progress')` assert (~dungeon-bridge.test.ts:83) → `'gathering'`; and the "moves each player to hidden coords on entry" test (~134-179) — players are NO LONGER at `-9999` immediately after `startDungeonGame` (only after a `gatherStep`). Revise or replace these.
- [ ] **Step 4: Run, confirm PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(dungeon): startDungeonGame stages a gathering phase + double-borrow guard"`

---

## Task 6: Cron branch + `listActiveInteractions` include gathering

**Files:** `convex/ours/queries/listActiveInteractions.ts`, `convex/ours/crons/interactionTick.ts`.

- [ ] **Step 1: Write failing test** — `listActiveInteractions` returns both `in_progress` AND `gathering` interactions (seed one of each, assert both returned).
- [ ] **Step 2: Run, confirm FAIL** (currently only `in_progress`).
- [ ] **Step 3: Implement** — `listActiveInteractions`: run two indexed queries (`q.eq('status','in_progress')` and `q.eq('status','gathering')` on `by_status_and_lastTickAt`), merge, sort by `lastTickAt`, `take(50)`. `interactionTick`: branch per row — `status==='gathering'` → schedule `gatherStep`; `'in_progress'` → schedule `interactionTakeTurn` (existing). Keep the shared `inflightSince` dedup.
- [ ] **Step 4: Run, confirm PASS** + full `interaction-framework.test.ts` green.
- [ ] **Step 5: Commit** — `git commit -am "feat(interactions): tick + listActive handle the gathering status"`

---

## Task 7: Return/cancel via `teleportPlayer` + delete-guard fix

**Files:** `convex/ours/mutations/appendInteractionTurn.ts` (88-116), `convex/ours/mutations/cancelInteraction.ts` (23-52). Optionally extract a shared `restoreDungeonPlayers(ctx, interactionId, worldId)` helper.

- [ ] **Step 1: Write failing tests** (`dungeon-bridge.test.ts`): on game-end and on cancel, for each `dungeonReturnState` row a `teleportPlayer` input is enqueued with the saved position/facing, and the row is deleted; **no `world.players` patch is performed by these mutations** (assert the world doc isn't directly rewritten with restored coords — restoration now happens via the engine input). Include the **absent-player** case: a return row whose `playerId` isn't in `world.players` still enqueues a `teleportPlayer` (the engine will no-op it) and the row is deleted — no silent strand, no crash.
- [ ] **Step 2: Run, confirm FAIL.**
- [ ] **Step 3: Implement** — replace the `world.players` patch loops (appendInteractionTurn.ts:97-114, cancelInteraction.ts:33-51) with: for each return row → `insertInput(ctx, inter.worldId, 'teleportPlayer', {playerId: ret.playerId as any, position: ret.savedPosition, facing: ret.savedFacing})` then `ctx.db.delete(ret._id)`. (These are mutations, so `insertInput` is called directly — `import { insertInput } from '../../aiTown/insertInput'`; no action wrapper.) No `findIndex`, no conditional delete.
  - **Update the existing restore test** (~dungeon-bridge.test.ts:181-249): it asserts `world.players` coords are directly restored, but restore now goes through an engine input that convex-test does not apply — so assert instead that a `teleportPlayer` input was enqueued per return row (with the saved coords) and the `dungeonReturnState` rows were deleted.
- [ ] **Step 4: Run, confirm PASS** + `interaction-framework.test.ts` green.
- [ ] **Step 5: Commit** — `git commit -am "fix(dungeon): restore via teleportPlayer input + drop the silent-strand delete"`

---

## Task 8: Whole-feature verification

- [ ] **Step 1: Full suite** — `npx vitest run` (only the known pre-existing card-validator/upload* failures allowed; confirm unchanged).
- [ ] **Step 2: Typecheck** — `npx tsc --noEmit -p convex` (only known cardValidator/yaml).
- [ ] **Step 3: CI guards** — `bash scripts/check-no-bare-llm-calls.sh`; `bash scripts/check-ai-town-additivity.sh` (rm any stray `tsconfig.tsbuildinfo` first). Both PASS.
- [ ] **Step 4: Sync integrity** — re-run `bash scripts/sync-ai-town.sh` and `git diff --exit-code convex/aiTown` (the synced tree must match the fork source; no drift).
- [ ] **Step 5 (GATING manual e2e — the live clobber can't be unit-tested):** on **dev** with the engine LIVE, `startDungeonGame` a real game (have one participant mid-conversation): confirm participants hide (after a tick), the talker finishes/force-leaves at 30s before pull-in, the game runs, and on end all participants **return to their pull-in spots and stay** (no `-9999`) across several ticks. Document the result.
- [ ] **Step 6: finishing-a-development-branch** — verify tests, then (per the user) merge this branch AND the parked `werewolf-seating-rules` branch to main locally.

---

## Notes for the implementer
- Engine edits MUST be in `ai-town-fork/` source; always run `scripts/sync-ai-town.sh` after and commit both trees. Never edit `convex/aiTown/` directly (wiped on sync).
- `insertInput` is imported as `import { insertInput } from '../../aiTown/insertInput'` (used in `gatherStep.ts`, `appendInteractionTurn.ts`, `cancelInteraction.ts`). Its typing wants GameId-ish types for `playerId`/`conversationId`; the `as any` casts in `forceEndAllConversations.ts` are the accepted pattern.
- `nextGatherAction` is the only pure-unit-testable core of the gather; everything else is convex-test integration via `seedAiTownWorld`.
- Keep `recoverStrandedAgents.ts` untouched (out of scope; still useful until this ships).
