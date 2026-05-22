# Contributing to agent-town

本指南面向计划提交 PR 的贡献者。技术架构、扩展点和硬性约束见 [`AGENTS.md`](AGENTS.md)。

## 提交流程

1. Fork 仓库并 clone 至本地。
2. 按 [`docs/running-locally.md`](docs/running-locally.md) 完成本地搭建。
3. 在 [Issues](../../issues) 中说明动机与方案，等待 maintainer 确认范围后再开始实现。范围明确的入门改动（见 `AGENTS.md` §8）可省略此步。
4. 从 `main` 创建分支，命名格式 `<type>/<short-slug>`，其中 `type` ∈ `{feat, fix, refactor, docs, test, chore}`。例：`feat/resident-list-search`。
5. 实现改动。提交频率：单次 commit 限定一个主题。
6. 使用 [Conventional Commits](https://www.conventionalcommits.org) 格式：`<type>(<scope>): <subject>`。示例：`feat(player-details): show recent path history`。
7. 提交前运行：
   ```bash
   bun test                          # 必须全部通过
   cd ai-town-fork && bun run build  # 若改动前端必跑（Vercel 用 bun 执行 tsc，比 npm 严格）
   ```
8. Push 后开 PR。模板位于 `.github/PULL_REQUEST_TEMPLATE.md`；逐项填写。

## 使用 AI 编程助手

允许并鼓励使用 AI 助手生成代码。提交此类 PR 须满足：

- 在助手开始工作前，确认其已读 [`AGENTS.md`](AGENTS.md)。该文件包含上游 additivity 约束、game state 写入规则、密钥处理等硬性条款，违反将导致 PR 被拒。
- 单个 PR 解决单个问题。Maintainer 不接受跨主题的"大杂烩" PR，即使总改动行数较少。
- 作者本人完整 review 助手生成的 diff，并对其负责。
- PR 描述中粘贴 `bun test` 实际输出，而非声明"测试通过"。

## 修改上游文件

下列路径多为 ai-town 上游同步文件：

- `convex/aiTown/`
- `convex/agent/`
- `convex/engine/`
- `ai-town-fork/convex/` 中对应路径
- `ai-town-fork/src/` 下的多数 React 组件

修改规则：

- 优先方案：将新功能放入 `convex/ours/` 或 `ai-town-fork/src/`（新文件不与上游冲突即可）。
- 必须修改上游文件时，在 `ai-town-fork/UPSTREAM_FILES.txt` 对应行末添加 EXEMPT 注释：

   ```
   ./convex/aiTown/main.ts   # EXEMPT: <one-line reason>
   ```

  无 EXEMPT 标注的上游 drift 会被 CI 拒绝。

## 不接受的改动

- 包含 `.env*`、`.vercel/`、API key、deploy key、生产 deployment URL 的提交。
- 直接 `ctx.db.patch()` 修改 `convex/aiTown/*` 表（必须经由 input + engine `runStep`，详见 `AGENTS.md` §4.2）。
- 自调度 action 链（详见 `AGENTS.md` §4.5）。
- 跨主题的大型 refactor，未事先经 issue 讨论。
- 引入新运行时依赖，未在 PR 描述中说明动机与替代方案对比。

## Code review

Maintainer：[@yisiliu](https://github.com/yisiliu)。合并策略：squash merge，commit message 取 PR 标题，body 取 PR 描述。

## License

提交的所有代码默认采用本仓库 [MIT 协议](LICENSE)。无需签署 CLA。
