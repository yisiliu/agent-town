# Dungeons — board games plugged into ai-town

review-suggest:skip

A **dungeon** is a board game (Werewolf, future plugins) launched from an
ai-town world with real ai-town agents as participants. The Interactions
framework runs the game; the dungeon bridge routes ai-town input in and
game outcomes back out.

## Anatomy of a dungeon launch

```
   ai-town world                    Interactions framework
   ─────────────────                ──────────────────────
   playerDescriptions
   agentDescriptions   ─┐
   worlds.agents       ─┤
                        │  startDungeonGame({ worldId, type,
                        │                     playerIds[], seed? })
                        ▼
                  findOrCreateTwinForAgent  ←──┐
                  (synthesizes card.md from    │
                   the agent's identity+plan)  │ idempotent — same
                        │                       │ (worldId, playerId)
                        ▼                       │ pair returns the
                   twins + cards                │ same twinId
                        │                       │
                        ▼                       │
                   interactions row             │
                   originType='dungeon'         │
                   worldId, originPlayerIds     │
                        │                       │
                        ▼                       │
                  the existing                  │
                  Werewolf engine ────────────┐ │
                  (cron, takeTurn,            │ │
                   appendInteractionTurn)     │ │
                                              ▼ │
   interactionMemories ◄──── on game end, write
   (originPlayerId set)      per-participant summary
```

## Live operator recipes

### Launch a Werewolf dungeon with 9 ai-town agents

```bash
# 1. Find the default ai-town world.
WORLD_ID=$(bunx convex run ours/queries/defaultWorldStatus:default '{}' \
  | jq -r '.worldId')

# 2. Pick 9 playerIds. (Inspect via convex data or seedTownPlayers' return value.)
bunx convex data worlds | head

# 3. Launch the dungeon.
bunx convex run ours/mutations/startDungeonGame:default \
  '{"worldId":"'$WORLD_ID'","type":"werewolf","playerIds":["p:1","p:2","p:3","p:4","p:5","p:6","p:7","p:8","p:9"],"seed":7777}'

# 4. The cron heartbeat picks the game up. Watch progress:
bunx convex run ours/queries/getInteraction:default '{"id":"<interactionId>"}'

# 5. When ended, inspect post-game memories per agent:
bunx convex data interactionMemories --limit 9 --order desc
```

### Idempotency

Calling `startDungeonGame` with the same `(worldId, playerId)` pair
twice **reuses the existing twin row** for that agent (lookup keyed on
`aitown:<worldId>:<playerId>` stored in `studentRealNameHash`). Each
call creates a new interaction row, so you can run multiple back-to-back
games with the same cast without dupe twins.

### Card.md synthesis

For an ai-town agent that has not been uploaded as a student twin, the
bridge synthesizes a Markdown persona card from the agent's existing
`playerDescription` (name, description, character sprite) +
`agentDescription` (identity, plan).

Format (compact 4-section — not strict Layer 0-5):

```markdown
---
family: celebrity
source: aitown_synth
---

# {name}
## 一句话定位
{first 80 chars of description / identity}
## 来历与身份
{full identity, trimmed to 400}
## 目标与心愿
{plan}
## 性格与说话方式
- character sprite + general guidance
## Worldview principles + Example exchanges
```

The card becomes the agent's system-prompt persona during the game.

### Plugging in a new dungeon type

The bridge does **not** know about specific game types. Adding a new
dungeon (e.g. Decrypto) requires only adding a plugin under
`convex/ours/interactions/<type>/`:

1. Define `state.ts` (your per-plugin state shape).
2. Define `rules.ts` (`initialState`, `planNextTurn`, `applyTurn`,
   `checkWin`).
3. Define `prompts.ts` (`buildSystemPrompt`, `buildUserPrompt`,
   `parseTurnText`).
4. Define `index.ts`: assemble `GamePlugin<TState>` + call
   `register(plugin)`.
5. Implement `summarizeFor(state, twinId)` on the plugin to drive
   post-game memory write-back.

Then call `startDungeonGame({ type: '<your type>', ... })` — no bridge
changes needed.

## Teleport in / teleport out

When `startDungeonGame` runs, each participating ai-town player is
**physically teleported off-screen** so they don't appear in the town
during the dungeon:

- Position → `(-9999, -9999)` (well outside any reasonable map viewport)
- `pathfinding` → cleared (they don't try to navigate from limbo)
- `activity` → cleared (no activity bubble)
- `speed` → 0

The original position + facing snapshot is saved to
`dungeonReturnState`. When the game ends (in `appendInteractionTurn`'s
`ended`-branch), the bridge:

1. Reads `dungeonReturnState` rows for this `interactionId`
2. Restores each player's `position` + `facing` to the saved values
3. Deletes the `dungeonReturnState` rows

**Other ai-town agents still see the dungeon participants in
`world.players[]`**, but the proximity check that gates conversations /
activities naturally fails when the target is 10,000+ tiles away. So
they effectively drop out of the town's social fabric until the game
ends.

### Future: "Tavern" entry point

Right now `startDungeonGame` is called manually. A future task can add:

1. A configurable tavern coordinate (currently exits restore to the
   original position, but could be changed to a fixed tavern coord).
2. An "agent walks to tavern → auto-queue for game" trigger (agentInputs
   patch + a queue table).

For v1, the conceptual flow is: instructor watches the town, picks N
agents who look interesting, calls `startDungeonGame`. They vanish.
After the game ends, they reappear exactly where they were.

## Limitations (v1)

- **No ai-town memory write-back yet.** The bridge writes to
  `interactionMemories` (a our-table). ai-town agents do not yet have a
  way to recall their dungeon experience via ai-town's `memories` table.
  Wiring this requires generating embeddings (Together e5-large) and
  extending ai-town's memory `data` union — separate task.
- **No spectator UI.** Inspect via `convex data interactions` or
  `ours/queries/listInteractionTurns:default`.
- **Manual launch only.** No "agent walks to a location and queues up
  for a game" automation. Instructor calls `startDungeonGame` directly.
- **Restore = original position.** Players reappear exactly where they
  were when the game started. Future tavern-based exit point is queued.

## `dungeonReturnState` table

One row per (interaction, player) pair, created on dungeon entry,
deleted on dungeon exit. Used to teleport players back to where they
came from.

| Field | Type | Notes |
|---|---|---|
| `interactionId` | `Id<'interactions'>` | which dungeon |
| `worldId` | `Id<'worlds'>` | which ai-town world |
| `playerId` | string | ai-town player (matches world.players[].id) |
| `savedPosition` | `{x, y}` | pre-teleport position |
| `savedFacing` | `{dx, dy}` | pre-teleport facing direction |
| `enteredAt` | number | timestamp |

## State table reference

`interactions` (with dungeon fields):

| Field | Type | When |
|---|---|---|
| `type` | string | always |
| `status` | 'lobby' / 'in_progress' / 'ended' | always |
| `participants` | `Id<'twins'>[]` | always |
| `state` | plugin-defined opaque JSON | always |
| `turnIndex` | number | always |
| `phase` | string | always |
| `lastTickAt` | number | always |
| `inflightSince` | number? | when an action is mid-flight |
| `seed` | number | always |
| `winner` | string? | on `status='ended'` |
| `originType` | 'standalone' / 'dungeon' | optional — `'dungeon'` for bridge launches |
| `worldId` | `Id<'worlds'>?` | set only for `originType='dungeon'` |
| `originPlayerIds` | `string[]?` | parallel to `participants`; same length |

`interactionMemories` (one row per participant per ended game):

| Field | Type | Notes |
|---|---|---|
| `interactionId` | `Id<'interactions'>` | |
| `twinId` | `Id<'twins'>` | the participant's twin |
| `originPlayerId` | string? | set for dungeon-origin games |
| `outcome` | string | plugin-defined: 'won' / 'lost' / 'cancelled' |
| `summary` | string | 1-2 sentence Chinese summary |
| `createdAt` | number | |
