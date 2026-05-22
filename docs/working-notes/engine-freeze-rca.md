# Engine freeze + silent promote failures — RCA

日期：2026-05-21  
事故引擎 id：`px72cn68ntaa4srtpgp92w3nc1874934`（已 wipe）  
恢复后引擎 id：`px7056tvay0jxmfc2a4hsyxxf5874tkh`

## 症状

1. 学生反馈：小镇里所有角色完全不动。
2. `engineState` 显示 `running: true`，但 `now - lastStepTs = 832,656 ms`（13.9 分钟）。`processedInputNumber: 151` 与十几分钟前相同 — 引擎完全没在 tick。
3. `listAllPlayers` 返回 28 个 player / 13 个 unique 名字 — 大量三重重复（万象×3、双飞燕×3 等）。

## 根因（两个独立 bug，叠加表现）

### Bug A：`runStep` 抛异常后不会 reschedule 自己

ai-town 上游 `aiTown/main.ts` 的 `runStep` 是这样工作的：

```
runStep:
  load world snapshot
  game.runStep(...)  ← side effects on snapshot
  save snapshot
  scheduler.runAt(next runStep)  ← schedule next tick
```

整个流程在**同一个 Convex mutation transaction** 里。`game.runStep`、`save`、或 `scheduler.runAt` 任一抛异常都会让 transaction 整体 rollback — 关键是**下一次 runStep 的调度也跟着 rollback**。引擎从此沉默，`running` 字段还是 `true`（因为那个 patch 也被 rollback 了），外部看起来一切正常。

可能的触发条件（在这次事故里最可能的几个）：
- 12 个 conversation 同时活跃 + 大量 `pathfinding.state.kind === 'needsPath'` agent，单个 tick 的 inputs/output 超过 Convex 的 single-mutation 写入上限（如 ~16MB）。
- `playerDescriptions` 里有重复 `name`，某个 in-memory map 在 serialize 时撞键。
- 路径找不到的 agent 在某些 corner case 进 infinite loop，runStep 超时（默认 1 分钟）。

**怎么确认**：Convex 仪表盘 → Functions → `aiTown/main:runStep` → 查最近的失败 invocation。CLI 没有方便的方式 dump。

**临时缓解**：`testing:stop` + `testing:resume` 强制重建 generation；或 `softResetWorld` 彻底重做 world snapshot。

**真正修复**（待做）：给 `runStep` 包一层兜底 — 即使 `game.runStep`/`save` 失败，也要单独 schedule 下一次 tick。这违反"事务一致性"但避免引擎死锁。需要权衡。

### Bug B：`pickSprite` 返回不存在的 character → `Player.join` 抛 `Invalid character: p1`

`convex/ours/mutations/promoteTwinToAgent.ts:21`：

```ts
const SPRITE_SLOTS = ['f1','f2','f3','f4','f5','f6','f7','f8','p1','p2','p3'];
```

但 `ai-town-fork/data/characters.ts` 只定义了 `f1`–`f8`。**Pseudonym 哈希到 p1/p2/p3 的 ~27% twin** 会失败：

- `promoteTwinToAgent` 把 `createAgentInline` input 塞进 engine queue → 返回成功
- engine 处理 input → `Player.join` 抛 `Invalid character: p1`
- input handler 把异常吞掉（per upstream 设计），player 没加入 world
- `listAllPlayers` 显示数量比 `active twins` 少
- 调用方（`removeNpcsAndPromoteStudents` 等）看不到任何错误

**修复**：移除 `p1/p2/p3`（commit applied this session）。SPRITE_SLOTS 现在只含 `f1`–`f8`，跟 characters.ts 保持一致。

## 重复 player 的原因

`Player.leave` 把 player 从 in-memory `world.players` map 移除，但**不删 `playerDescriptions` 表的行**。每次：

1. 学生重传 card → uploadTwin 创建新 active twin
2. `runTwinScans` 在 scan-pass 时 auto-promote → 加入新 player + 新 playerDescription
3. 老 player（如果有）没被 leave，留在世界里同时有两个同名

`dedupActiveTwins`/`dedupWorldPlayers` 只是把 leave input 排进队列。如果 engine 卡住，leave 不会被处理，重复保留。

**真正修复**（待做）：在 `promoteTwinToAgent` 里检查 — 同名 player 已存在就先发 leave，再 join；或者 uploadTwin 检测重传时直接 patch 现有 active twin 而不是创建新的。

## 这次恢复用到的工具链

```
removeNpcsAndPromoteStudents  # 删 synth-*  twin（实际已无）；promote 孤儿学生
dedupActiveTwins              # 同名 active twin 只留 createdAt 最新；旧的 suspended
softResetWorld                # wipe 所有 runtime 表（保留 twins/cards/auth），re-init，重新 promote
removeNpcsAndPromoteStudents  # 二次 promote — sprite 修复后捕获 p1/p2/p3 失败那批
```

## 应该做的预防

1. **`pickSprite` 加一道 assert**：返回值必须在 `characters.find(c => c.name === slot)` 集合里，否则抛错。让 promoteTwinToAgent 阶段就 fail，不要让 engine 静默吞错。
2. **`promoteTwinToAgent` 检测 in-world 同名 player**：先 leave 再 join，避免堆积。
3. **runStep 兜底 scheduler**：跑一个独立的 cron 每 60s 检查 `now - lastStepTs > 10s && running === true`，触发 testing:resume/kickEngine 自愈。
4. **wipe playerDescriptions on leave**：让 leave handler 也清掉对应的 playerDescriptions 行，listAllPlayers 才不会有幽灵数据。

四项里 1 已经做了；2/3/4 待后续做。
