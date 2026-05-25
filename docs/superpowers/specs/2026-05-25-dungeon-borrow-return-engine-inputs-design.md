# Dungeon Borrow/Return via Engine Inputs — Design Spec (v2)

**Date:** 2026-05-25
**Status:** Approved (spec-review v2 — three-reviewer findings folded in)
**Scope:** `convex/ours/` (startDungeonGame, appendInteractionTurn, cancelInteraction, a new gather action, interactionTick, listActiveInteractions, interactions table) + a minimal **`ai-town-fork/` source** change (new fork file + one-line `inputs.ts` spread + `UPSTREAM_FILES.txt` exemption + `sync-ai-town.sh` propagation). Plus tests.

## Goal

Stop the ai-town engine from clobbering the dungeon/werewolf borrow/return of agents, and let an agent finish an in-progress conversation before being pulled into a game.

## Background / Problem (verified)

`world.players` is owned solely by the engine: every `runStep` loads a snapshot and `saveDiff` does `ctx.db.replace(worldId, newWorld)` (`convex/aiTown/game.ts:305`). The dungeon borrow/return patches `world.players` **directly**, so while the engine is live an in-flight `runStep` replaces the world *after* the restore — clobbering it. **Verified facts from the live incident (game `mn75rhbb`):**
- **Borrow works.** Hidden agents sat at `-9999` for the whole game + hours (that's how `recoverStrandedAgents` found 12 of them). `agentDoSomething` fires for them but pathfinding from off-map fails, so they stay — **no engine "borrowed-guard" is needed.**
- **Return is reliably clobbered** → agents stranded. Secondary bug: the restore loop deletes the `dungeonReturnState` row even when `idx === -1` (appendInteractionTurn.ts:112; same in cancelInteraction.ts:48) → silent + unrecoverable.

See memory `world-players-engine-clobber`. The one-off `recoverStrandedAgents` already un-stranded the affected agents.

**Fork topology (critical):** `convex/aiTown/` is GENERATED — `scripts/sync-ai-town.sh` does `rm -rf convex/aiTown && cp -r ai-town-fork/convex/aiTown` (+ a `scripts/patches/` overlay). So engine changes MUST land in `ai-town-fork/` source, never the generated `convex/aiTown/`. The additivity gate (`check-ai-town-additivity.sh`) scans `ai-town-fork/`.

## Decisions (locked)

1. Route **borrow + return + cancel** through a new engine input (`teleportPlayer`) — no direct `world.players` writes left in the interaction system.
2. Borrow is **staged + conversation-aware**: an agent in a conversation finishes it before being pulled in; **snapshot position at pull-in**.
3. **30s grace, then force-leave** (`leaveConversation` input) + pull.
4. Fix the **unconditional-delete** so a return never strands silently.

## Design

### A. New engine input `teleportPlayer` (fork source)

Instant teleport (no pathfinding — `moveTo` pathfinds, useless from off-map). Handler mirrors `playerInputs.moveTo` (`ai-town-fork/convex/aiTown/player.ts:291`):

```
teleportPlayer({ playerId, position:{x,y}, facing:{dx,dy} }):
  p = game.world.players.get(parseGameId('players', playerId))   // throw if missing
  p.position = position; p.facing = facing
  p.pathfinding = undefined; p.activity = undefined; p.speed = 0
```

**Mechanism (verified against sync-ai-town.sh):**
- Add a new fork file `ai-town-fork/convex/aiTown/dungeonInputs.ts` (imports `inputHandler`, `parseGameId`; no cycle). It is under `ai-town-fork/convex/aiTown/`, so the wholesale `cp -r .../aiTown` propagates it on sync — **no new `cp` line needed**.
- Add `...dungeonInputs` to the `inputs` map in `ai-town-fork/convex/aiTown/inputs.ts` (one line). This makes `'teleportPlayer'` a valid `InputNames`, so `insertInput(ctx, worldId, 'teleportPlayer', …)` type-checks.
- Update `ai-town-fork/UPSTREAM_FILES.txt`: add `# EXEMPT: dungeon teleport input` on the `inputs.ts` line, and allowlist the new `dungeonInputs.ts` file (whatever the additivity gate requires for a new fork file — confirm against `check-ai-town-additivity.sh` in the plan).
- Run `scripts/sync-ai-town.sh` so `convex/aiTown/` reflects the source; CI runs on the synced tree.

Applied in `handleInput`→`saveDiff` in one step → **never clobbered**; works live or frozen.

### B. Borrow → staged, conversation-aware gathering

**Schema (`convex/ours/tables/interactions.ts`):** add `v.literal('gathering')` to the `status` union (do NOT reuse `'lobby'` — it's dead/never-written; optionally delete it, no migration since unused). Add `pendingPlayerIds: v.optional(v.array(v.string()))` and `gatheringStartedAt: v.optional(v.number())`.

**`startDungeonGame`:**
- Insert with `status: 'gathering'`, `pendingPlayerIds = args.playerIds`, `gatheringStartedAt = now`. **Delete** the immediate hide + snapshot block (startDungeonGame.ts:75-112) — it moves to the gather step.
- **Double-borrow guard:** reject (throw) if any requested playerId already appears in another non-ended dungeon interaction's **`originPlayerIds` ∪ `pendingPlayerIds`** (NOT `participants` — those are twin IDs, never ai-town playerIds).
- Kick the gather chain (schedule the gather action, below).

**Gather driver (the 1-min cron is too coarse for 30s):** a self-scheduled `gatherInteraction` action, analogous to the `interactionTakeTurn` chain (`+~3s` re-schedule), kicked by `startDungeonGame` and also by `interactionTick`. Since `interactionTick` will now also receive `gathering` rows (§D), it must **branch on status**: schedule `gatherInteraction` for `gathering` rows and `interactionTakeTurn` for `in_progress` rows (shared `inflightSince` dedup works for both). Each run calls ONE internalMutation `gatherStep(interactionId)` that, **atomically**:
- Loads the world. For each `pendingPlayerId`:
  - In a conversation? Use the serialized-array form (precedent `forceEndAllConversations.ts:32-35`): `world.conversations.find(c => c.participants.some(m => m.playerId === pid))`.
  - **Not in a conversation** → insert `dungeonReturnState` (snapshot current pos/facing) + `insertInput('teleportPlayer', → -9999)` + remove from `pendingPlayerIds`.
  - **In a conversation & `now - gatheringStartedAt < 30_000`** → leave pending (wait).
  - **In a conversation & ≥ 30s** → `insertInput('leaveConversation', { playerId, conversationId: conv.id })` **first**, then snapshot + `insertInput('teleportPlayer', → -9999)` + remove from pending. (Enqueue `leaveConversation` before `teleportPlayer` so its lower input-number applies first — the conversation ends before the teleport.)
  - **Player missing from `world.players`** (left world / claimed elsewhere) → the game can't proceed (werewolf needs all roles): **cancel the interaction** (restore any already-pulled players via §C, mark `ended`/cancelled). Avoids a permanent gather hang.
- When `pendingPlayerIds` is empty → set `status: 'in_progress'` and kick the normal `interactionTakeTurn` chain. The turn machinery already no-ops unless `in_progress` (appendInteractionTurn.ts:28, interactionTakeTurn.ts:53), so turns **naturally wait** until everyone is gathered.
- The gather action re-schedules itself while `status === 'gathering'`; stops when `in_progress`/`ended`.

### C. Return → via input + delete-guard fix

On game-end (`appendInteractionTurn` `win.ended` branch), `cancelInteraction`, AND the gather-cancel path (§B missing-player): for each `dungeonReturnState` row → `insertInput('teleportPlayer', → { savedPosition, savedFacing })`, **then** delete the row. The position rides in the input, so deleting after enqueue is safe and the restore is engine-applied (no clobber). This **replaces** the direct `world.players` patch (appendInteractionTurn.ts:99-114, cancelInteraction.ts:36-48) and removes the unconditional-delete bug (no more `findIndex` dependence). Cancel during `gathering` only has rows for already-pulled players — restoring exactly those is correct.

### D. `listActiveInteractions` must include gathering

It currently hard-filters `q.eq('status','in_progress')` on the `by_status_and_lastTickAt` index, so a `gathering` interaction is invisible and the gather never runs (silent hang). Broaden to return both `in_progress` and `gathering` — two indexed queries merged (a single `.eq` can't disjunct). First-class task, not a footnote.

## Testing

- **Unit:** `teleportPlayer` handler sets pos/facing, clears pathfinding/activity/speed, throws on missing player.
- **Pure gather helper** `nextGatherAction(world, pid, gatheringStartedAt, now) → {pull} | {wait} | {forceLeaveThenPull, conversationId} | {missing}`: free→pull; talking&<30s→wait; talking&≥30s→forceLeave (asserts conversationId carried); player-absent→missing. Test each branch.
- **Return/cancel:** game-end / cancel / gather-cancel enqueue a `teleportPlayer` per return row and delete the rows; assert NO direct `world.players` write remains in the interaction system (grep + unit); assert a return row whose player is absent still enqueues + is handled deterministically (the locked no-silent-strand requirement).
- **Double-borrow guard** rejects a playerId already in another live dungeon game.
- Update `convex/tests/dungeon-bridge.test.ts`.
- **Behavioral gap (GATING acceptance criterion, not a footnote):** unit tests cannot exercise the live-engine clobber. Manual dev check with the engine LIVE: start a dungeon game, confirm participants hide; have one participant be mid-conversation at start and confirm it finishes (or force-leaves at 30s) before they're pulled; end the game; confirm all return to their pull-in positions and **stay** (no `-9999`) across several ticks.

## Risks / known behaviors

- **agentDoSomething churn:** hidden agents still fire `agentDoSomething` (failed `moveTo`, or `startConversation` invites to town agents that can't converge from off-map). Verified harmless (games completed; agents stayed at -9999) — no guard added. Note it; revisit only if it causes visible weirdness.
- **`dedupWorldPlayers`** (a separate `ours/` writer of `world.players`) is out of scope — the "no dual-writer" claim is scoped to the interaction system.
- **Frozen engine:** inputs are processed at the (stretched) frozen step pace, so the 30s grace bounds *input-application* delay, not strict wall-clock; under deep freeze the real delay can exceed 30s by one step. Acceptable.
- **Fork fragility:** keep the `inputs.ts` change to one line; isolate logic in `dungeonInputs.ts` to minimize rebase pain.

## Out of scope

Werewolf seating/归票/silent-vote (parked branch); UI/spectator; non-dungeon `startInteraction`; the already-shipped `recoverStrandedAgents`.
