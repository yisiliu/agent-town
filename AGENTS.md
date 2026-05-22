# AGENTS.md

> 这个文件是写给 AI coding 助手（Claude Code、Cursor、Codex 等）的项目导航。
> 人类读 `README.md` + `CONTRIBUTING.md` 即可。

## 你的任务

学生 fork 此仓库并依赖你完成改动。开始编码前请通读本文档：§3 给出仓库布局，§4 列出硬性约束，§6 描述验证流程。

需求不明确时，先在 issue 或对话中确认范围，再开始实现。不要凭推测改动架构。

---

## 1. 项目使命

本项目是 [a16z ai-town](https://github.com/a16z-infra/ai-town) 的中文课堂 fork，用于教学。学生通过上传 `card.md` 注册数字分身，由 LLM 依据卡片内容驱动其在镇上的行为。

设计取舍：

- 优先可读性而非抽象：三行重复优于引入一次性抽象。
- 保留 `convex/ours/` 目录约定，便于学生区分本 fork 新增代码与上游代码。
- 已知边缘 case 记录于 §7，不在当前迭代修复。

---

## 2. 技术栈

| 层 | 技术 | 路径 |
|---|---|---|
| **后端** | [Convex](https://docs.convex.dev) | `convex/` |
| **2D 模拟** | [a16z ai-town](https://github.com/a16z-infra/ai-town)（fork）+ Pixi.js + React | `ai-town-fork/` |
| **学生/教师 UI** | Next.js + Tailwind | `shell/` |
| **包管理** | `bun` (workspaces) | 根 `package.json` |
| **LLM** | DeepSeek V4 Pro/Flash（对话/反思）+ MiniMax embo-01（中文 embedding）+ Together Llama Guard（注入扫描） | `convex/ours/lib/` |

**Convex 必读**：开始写 Convex 代码前，**先看 `convex/_generated/ai/guidelines.md`**——里面有 Convex API 的规则，会覆盖你训练数据里关于 Convex 的旧知识。

---

## 3. 仓库布局

```
agent-town/
├── README.md                 # 人类入口
├── AGENTS.md                 # 本文件
├── CONTRIBUTING.md           # 人类协作流程
├── CLAUDE.md                 # 指向 AGENTS.md
│
├── convex/                   # Convex 后端
│   ├── _generated/           # 自动生成，禁止手动编辑
│   ├── aiTown/               # 上游 ai-town 引擎（受 §4 约束）
│   ├── agent/                # 上游 LLM 对话与记忆（受 §4 约束）
│   ├── engine/               # 上游通用引擎抽象（受 §4 约束）
│   ├── util/llm.ts           # 上游 LLM 配置（本 fork 已修改）
│   ├── crons.ts              # cron 注册入口
│   ├── schema.ts             # schema 入口，组合 ours/ tables
│   └── ours/                 # 本 fork 新增的全部后端代码
│       ├── tables/           # Convex 表定义
│       ├── queries/          # query（前端订阅）
│       ├── mutations/        # mutation（短同步副作用）
│       ├── actions/          # action（长异步副作用，如 LLM 调用）
│       ├── crons/            # cron handler
│       └── lib/              # 共享纯函数
│
├── ai-town-fork/             # 2D 前端 + ai-town upstream
│   ├── UPSTREAM_FILES.txt    # 上游文件 allowlist（受 §4.1 约束）
│   ├── src/                  # React + Pixi 前端
│   │   ├── components/       # 多数为上游文件
│   │   │   ├── Game.tsx              # EXEMPT: viewportRef 上移至 Game.tsx
│   │   │   ├── PixiGame.tsx          # EXEMPT: viewportRef 改由 props 传入
│   │   │   ├── PlayerDetails.tsx     # EXEMPT: 增加对话历史与反思区块
│   │   │   ├── ResidentList.tsx      # 本 fork 新增
│   │   │   └── ...
│   │   └── hooks/            # 上游 React hooks
│   └── convex/               # 上游 convex 副本（参考用，不参与部署）
│
├── shell/                    # Next.js 学生/教师入口
│   ├── src/app/upload/       # card.md 上传
│   ├── src/app/chat/         # 学生与自身分身私聊
│   ├── src/app/instructor/   # 教师控制台
│   └── src/app/spec/         # card.md 格式规范
│
├── data/                     # 地图与 spritesheet
├── docs/                     # 扩展文档
│   ├── running-locally.md    # 完整本地搭建步骤
│   ├── card-md-spec.md       # card.md 格式
│   └── working-notes/        # 事故 RCA、架构决策记录
├── scripts/                  # sync-ai-town.sh 与 patches/
├── fixtures/cards/           # 测试用 card.md 样本
└── tests/                    # vitest 集成测试
```

---

## 4. 硬性约束

### 4.1 上游 additivity gate

`ai-town-fork/UPSTREAM_FILES.txt` 是上游 ai-town 文件的 allowlist。规则：

- `ai-town-fork/` 下所有不属于 `ours/` 的文件须在 `UPSTREAM_FILES.txt` 中登记。
- 修改上游文件须在对应行末追加 `# EXEMPT: <one-line reason>`。
- 缺失 EXEMPT 标注的 drift 在 CI 中被拒。
- 新增文件应放入 `ours/`（前后端各自存在）。

Convex 后端的对应规则：`convex/aiTown/`、`convex/agent/`、`convex/engine/` 由上游同步生成，patch 维护于 `scripts/patches/`，sync 流程见 `scripts/sync-ai-town.sh`。

新增功能优先创建新文件于 `ours/`，避免修改 allowlist 内的上游文件。

### 4.2 严禁直接 mutation game state

ai-town 的 `convex/aiTown/*` 表（`worlds`, `engines`, `playerDescriptions`, `agentDescriptions`, `conversations`, ...）只能通过 **input** 改变，input 由 engine 在 `runStep` 里单线程处理。

直接 `ctx.db.patch` 这些表会破坏 game state 的确定性，可导致引擎死锁、序列化失败或不可重现的状态错乱。

正确模式：

```ts
// 加 player
await insertInput(ctx, worldId, 'createAgentInline', { ... });

// player 离开
await insertInput(ctx, worldId, 'leave', { playerId });
```

禁止模式：

```ts
ctx.db.patch(worldDoc, { players: ... });  // 直接修改 game state 表
```

例外：`convex/ours/actions/softResetWorld.ts` 直接 wipe 整张表，仅用于"全清重建"场景，且 engine 必须已停或已被新 engine 替换。

### 4.3 学生数据保护

`twins`、`cards`、`consents`、`authCodes`、`studentSessions`、`instructorAuthenticators` 表存储学生数据。约束：

- 新增 feature 时不得修改或删除上述表中的现有行。
- reset 类工具须保留上述表（实现参考 `softResetWorld.ts` 的 `PRESERVE` 列表）。
- 删除学生数据须经学生明确同意。spec 中规定的 data export / retraction 流程目前为 stub。

### 4.4 密钥处理

- 不得读取、日志或提交 `.env*` 文件。
- 不得在代码中硬编码 API key、deploy key 或生产 deployment URL。
- 后端密钥使用 `bunx convex env set` 设置。
- 若 diff 中出现疑似密钥字符串，立即停止并报告。

### 4.5 不要在 action 中自调度后继

ai-town 上游 `runStep` 采用如下模式：

```ts
export const myAction = action({
  handler: async (ctx) => {
    await doWork();
    await ctx.scheduler.runAfter(2500, internal.module.myAction, {});
  }
});
```

Convex 平台 transient（部署、扩缩容、容器重启）会在 handler `try/catch` 之前终止 action，日志中表现为 `duration=0ms` / `0 GB-hr`。一旦中断，调度链永久断裂，无任何错误信号。

替代方案：

- 将循环逻辑实现为 mutation。Convex 自动重试 mutation 上的 transient 错误（[scheduling docs](https://docs.convex.dev/scheduling/scheduled-functions)）。
- 由 Convex cron 重复调用，而非 self-schedule。
- 暴露 `httpAction` 端点，由外部 uptime monitor 周期触发。

完整 RCA 见 `docs/working-notes/engine-freeze-rca.md`。

---

## 5. 按改动类型，去哪写

| 改动类型 | 路径 |
|---|---|
| 加一个学生 UI 能订阅的 query | `convex/ours/queries/<name>.ts` |
| 加一个写入 Convex 的同步操作 | `convex/ours/mutations/<name>.ts` |
| 加一个调 LLM / 外部 API 的异步操作 | `convex/ours/actions/<name>.ts` |
| 加新表 | `convex/ours/tables/<name>.ts` + 加到 `convex/ours/tables/index.ts` |
| 加定时任务 | handler 放 `convex/ours/crons/<name>.ts`，注册到 `convex/crons.ts` |
| 加新前端 React 组件（2D 小镇里） | `ai-town-fork/src/components/<Name>.tsx` + 登记到 `UPSTREAM_FILES.txt` |
| 加新前端页面（学生/教师入口） | `shell/src/app/<route>/page.tsx`（Next.js App Router） |
| 改 agent 行为（怎么决定下一步动作） | `convex/agent/agent.ts` 或 `convex/aiTown/agent.ts`（注意是上游，要 EXEMPT） |
| 改对话 prompt 模板 | `convex/agent/conversation.ts`（已 EXEMPT，patch 在 `scripts/patches/`） |
| 加新 input 类型让前端能触发 game state 变化 | `convex/aiTown/inputs.ts` + 在 `player.ts`/`conversation.ts`/`agentInputs.ts` 加 handler（上游，要 EXEMPT） |
| 换 LLM 模型 | `convex/util/llm.ts` 或 `convex/ours/lib/*Client.ts`，配合 `bunx convex env set` 改环境变量 |
| 改地图 | `data/gentle.js`（已 EXEMPT），用 [Tiled](https://www.mapeditor.org) 导出 JSON → `data/convertMap.js` 转换 |
| 改 spritesheet（人物形象） | `ai-town-fork/data/characters.ts` + PNG 在 `ai-town-fork/public/assets/` |

---

## 6. 跑起来 + 验证

**完整本地搭建**：`docs/running-locally.md`。

**常用命令**：

```bash
# 终端 1：后端，需持续运行
bunx convex dev

# 终端 2：学生/教师 shell
cd shell && bun dev

# 终端 3：2D 小镇前端
cd ai-town-fork && bunx vite

# vitest 集成测试
bun test

# 部署至 prod
bunx convex deploy --yes                       # 后端
cd ai-town-fork && npx vercel deploy --prod    # 2D 小镇
cd shell && npx vercel deploy --prod           # shell
```

**验证流程（改动后必须执行）**：

1. `bun test`：vitest 全部通过。
2. 若改动前端：`bun run build` 通过。Vercel 使用 `tsc && vite build`，bun 执行 tsc 较 npm 严格，需以 bun 验证。
3. 浏览器手动验证至少一条 golden path 与一条 edge case。
4. 若改动涉及引擎：让小镇运行 5 分钟，确认 `engine.lastStepTs` 与现实时间的差不持续增长。

声明任务完成前，须在回复中粘贴执行过的命令及其输出。UI 改动无法在浏览器中验证时，需明确标注"未在浏览器验证"。

---

## 7. 已知 gotchas

按再次踩坑概率排序。

### 7.1 Convex transient 会终止 action 但不会终止 mutation

详见 §4.5 与 `docs/working-notes/engine-freeze-rca.md`。特征：日志中出现 `Transient error while executing action`，`duration = 0ms`。

对策：长生命周期或关键路径逻辑实现为 mutation。本仓库已有 watchdog cron 兜底引擎死亡，实现见 `convex/ours/crons/engineWatchdogMutation.ts`。

### 7.2 引擎时钟落后于现实时间

单次 `runStep` 可推进的最大 in-game 时间为 `maxTicksPerStep × tickDuration = 600 × 16ms = 9.6s`。当 wall-clock 推进速度高于此（例如 frozen 模式下 30s 一次 tick），`engine.currentTime` 持续落后于现实且无法追平。

落后达数分钟后，新提交的 input（`received = Date.now()`）在引擎视角下为未来事件，永远不会被处理。

对策：`devForceResumeWorld` 在 resume 时执行 stop + start，将 `engine.currentTime` 强制设为 `Date.now()`；watchdog 的 revive 路径同样如此。实现新的 `runStep` 风格循环时须注意此上限。

### 7.3 同名 player 易堆积

`Player.leave` 将 player 从 in-memory `world.players` 中移除，但不删除 `playerDescriptions` 表中的描述行。学生重传 card.md 会留下孤儿描述行。

对策：`promoteTwinToAgent` 在加入新 player 前先 leave 同名旧 player 并 suspend 旧 active twin。新增创建 player 的代码须沿用此模式。

### 7.4 sprite 名称须存在于 characters.ts

`Player.join` 校验 character 字符串是否在 `data/characters.ts` 中定义。若 `pickSprite` 返回不存在的 slot（如 `p1`），`createAgentInline` input 处理时静默失败，player 不会创建，调用方无任何错误回传。

对策：`convex/ours/mutations/promoteTwinToAgent.ts` 中的 `SPRITE_SLOTS` 须与 `ai-town-fork/data/characters.ts` 中的 character name 列表保持一致。

### 7.5 Convex 序列化不接受非 ASCII 字段名

Convex JSON 序列化拒绝非 ASCII 字段名。`Map<chinese_name, value>` 在跨 mutation 边界传递时抛出 `Field name 万 has invalid character`。

对策：使用 `{name: string, value: ...}[]` 数组代替 record。实现参考 `removeNpcsAndPromoteStudents.ts:listActivePlayerNames`。

### 7.6 Vercel 使用 bun 执行 tsc，严格度高于 npm

`bun x tsc` 报告若干 `npx tsc` 不报告的类型错误（如 `usehooks-ts` 的可选返回值）。本地验证须使用 `bun run build`，以匹配 Vercel 行为。

### 7.7 runStep 单步日志会撞 256-line 上限

Convex action 日志上限是 256 行/调用。runStep 一次循环可能跑 10+ 次 game tick，每个 tick 多个 agent 决策，原生 ai-town 每个 op 一行 log → 撞顶后无声 dropped。

**对策**：`scripts/sync-ai-town.sh` 在 sync 时用 `sed` 注释高频 `console.log`。若上游新增 log 在 sync 后未被注释，需更新该脚本的过滤规则。

---

## 8. 起步选题

下列改动范围明确，可作为入门 PR。标注 `[教学价值高]` 的条目实现后可作为 LLM agent 设计模式的示例。

### 轻量（1–3 文件）

- `[教学价值高]` **PlayerDetails 增加移动轨迹区块**。读取 `historicalLocations`，渲染最近若干秒的路径。涉及概念：游戏状态的时间序列结构。
- **居民列表增加状态过滤**。从 `game.world.players` 与 `playerConversation()` 派生 `对话中 / 空闲 / 走路中` 等状态。
- **居民列表增加"召唤"按钮**。复用既有 `moveTo` input，触发目标 agent 走向 human player。
- **教师控制台增加"清空所有对话"按钮**。绑定既有 action `forceEndAllConversations`。
- **`/spec` 页面增加 card.md 实时预览**。markdown 渲染加 validator 错误提示。

### 跨层（后端 + 前端）

- `[教学价值高]` **显示 agent 间的关系强度**。`memories` 表已存在 `data.type === 'relationship'` 行；新增 query 聚合并渲染。
- `[教学价值高]` **增加"向指定 agent 提问" input**。human player 选定目标后直接触发对话生成，跳过 walk-to-target 阶段。涉及概念：自定义 input 与 agent operation 的最小完整示例。
- **支持 card.md 增量更新**。当前 `uploadTwin` 创建新 twin 并 suspend 旧者；改为原地更新 card，同步刷新 in-world agent identity。
- **增加广播事件机制**。基于 `townEventState` 表，教师触发后所有 agent 在下一 tick 收到事件并作出反应。

### 架构级

- `[教学价值高]` **runStep 改为 cron-driven**。取消 self-schedule，由 cron 每 2.5s / 30s 调用一次。须处理 in-flight runStep 并发与 generation 编号竞争。
- `[教学价值高]` **watchdog 改为外部 HTTP 触发**。新增 `httpAction` 端点，由 cron-job.org 或 GitHub Actions schedule 周期调用，绕开 Convex cron 调度路径。
- **多人 mini-game 框架**。`convex/ours/interactions/` 已含狼人杀骨架，可扩展为其他游戏（剧本杀、谁是卧底等）。
- **avatar 图片上传**。`avatars` 表已 stub，但 `sharp` 在 Convex Node runtime 的可用性未验证（见 `docs/running-locally.md` §9）。

### 不在上面列表里的想法

先看 `docs/working-notes/`，那里记录了历史事故与设计决策。

---

## 9. 与维护者协作

- 涉及上游 EXEMPT、schema 变更、架构调整时，先在 issue 中描述方案，确认后再实现。
- 不要在任务范围之外重构。

---

## 10. 提交前检查清单

- [ ] 每行改动都有理由
- [ ] 上游文件改动均有 EXEMPT 标注（见 §4.1）
- [ ] 未提交 `.env*` / 密钥 / 真实学生数据
- [ ] `bun test` 通过
- [ ] 改动 UI 的部分已在浏览器验证（无法验证时明确标注）
