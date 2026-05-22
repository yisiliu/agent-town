# 课堂作业：给 agent-town 做一个有意义的改进

每位同学独立提交一个 PR，实现一个有意义的改进。重点是练习"与 AI 编程助手协作完成真实工程任务"。

第一次跟 AI 协作做真实工程，搞砸一部分是预期内的。披露段就是给你写"哪里卡住了 / AI 走偏了 / 我怎么扶回来"的地方——把过程如实写下来就是这门课要练的事，跟做出多漂亮的 feature 同样重要。

## 关键时间

| 节点 | 时间（北京时间） |
|---|---|
| Claim issue + 开始动手 | 即日起 |
| PR 提交截止 | **2026-06-05（周五）23:59** |
| 老师 review 截止 | 2026-06-12（周五）23:59 |
| 成绩公布 | 2026-06-15 前 |

逾期提交 = 缺交（0 分）。

## 提交流程

1. **Fork**：在 https://github.com/yisiliu/agent-town 页面右上角点 `Fork`，fork 到你自己的 GitHub。
2. **选 issue**：浏览带 `课堂作业-2026spring` 标签的 [Issues](https://github.com/yisiliu/agent-town/issues?q=label%3A%E8%AF%BE%E5%A0%82%E4%BD%9C%E4%B8%9A-2026spring)，挑一个你感兴趣的。
3. **Claim**：在 issue 评论里发 `/claim`（开头是斜杠，后面可带说明）。老师看到后会把 issue 的 `Assignee` 设为你——以 `Assignee` 实际被设置为准（通常当天处理；急的话在 [#1](../../issues/1) 喊一声）。
4. **本地搭建**：参考 [`docs/running-locally.md`](docs/running-locally.md)。
5. **写代码**：在你的 fork 上创建分支，命名 `feat/<short-slug>` 或 `fix/<short-slug>`。
6. **测试**：本地必须跑通 `bun test`。**改动了前端**（`shell/` 或 `ai-town-fork/src/` 下任意文件）也必须跑通 `cd <subproject> && bun run build`。改动仅在 `convex/` 内则只跑 `bun test`。
7. **开 PR**：从你 fork 的分支 → `yisiliu/agent-town` 的 `main`。PR 模板（`.github/PULL_REQUEST_TEMPLATE.md`）会自动出现，**逐项填齐**。
8. **登记**：在 [#1 作业登记帖](https://github.com/yisiliu/agent-town/issues/1) 下评论你的 PR 链接 + 学号 + 姓名（中文）。**未登记的 PR 不计入成绩**。

## Claim 与释放规则

- 一人同时只能 active claim 1 个 issue。
- Claim 后 **5 天**内没有**实质性** commit 推到 fork（不含纯 README / 空文件）→ 老师 unassign + 评论 `released`，issue 重新开放。这是为了让占坑没动的 issue 让出来给别人，不是惩罚。
- 想换 issue：在原 issue 评论 `/unclaim`，老师 unassign 后再 claim 新的。
- 自己开 issue 提议选题：用 issue template `feature_proposal.md`。老师 approve + 打难度标签后才能 claim。提议必须高于"改个颜色/改个 typo"这一档（合法的最低档是 `难度-轻`，**不加分但完全合法**）。

## AI 使用要求

**必须使用** AI 编程助手（Claude Code / Cursor / Codex / 其他 LLM-based 编程工具）。**必须如实披露**——核心目的是让你养成 "review 而不是盲信 AI 输出" 的习惯。

PR 描述里 "AI 使用披露" 段按难度分档：

**`难度-轻`** 必填：

1. 工具 + 模型（如 `Claude Code, Claude Sonnet 4.6`）。
2. **一段反思**（150-300 字）：AI 帮你最关键的一步是什么？你 review 时改了什么、加了什么？哪里你跟 AI 来回讨论了几轮？

**`难度-中` / `难度-架构`** 在上面基础上补：

3. 至少 2 段代表性 prompt 节选 + AI 关键回答片段（不需要完整 transcript）。
4. 至少 1 段 AI 原始输出 vs 你最终 commit 的 diff 对比，说明你为什么改。
5. 如果遇到 AI 明显犯错，举一个具体例子；**没遇到**也说一下你是怎么 review 的（"我让 AI 把改动逐行解释一遍，确认没有 mock 数据漏在代码里"）。**不强制造错给老师看**。

诚实记录"我跟 AI 吵了三轮才把第 4 版方案合进来"比"AI 一遍写对，我直接 merge"分更高——后者要么真神，要么没 review。

编造披露（与 PR diff 严重不符）会被发现，按学术不端处理；如实写就拿分，写得糙也比不写好。

## 评分

总分 100 + 难度加分 + 反思加分（不封顶）。

| 维度 | 满分 | 说明 |
|---|---|---|
| **改动正确** | 30 | 解决了 issue 描述的问题；`bun test` 全绿；改了前端则对应子目录 `bun run build` 通过 |
| **符合 [AGENTS.md](AGENTS.md) §4 硬规则** | 20 | 违反一条扣 10 分；故意违反或破坏学生数据 = 一票否决 |
| **AI 披露完整度** | 25 | 按难度档要求项，缺一扣 5 分 |
| **Commit 历史 + PR 描述清晰度** | 15 | 单一主题、conventional commit 格式、PR 描述能让 reviewer 不用读 diff 就大概懂 |
| **代码质量** | 10 | 不留死代码、不引入无理由依赖、没有"顺手改"无关代码 |
| **难度加分** | +0 / +5 / +15 | 按 issue 的 `难度-` 标签固定：轻 +0、中 +5、架构 +15 |
| **教学价值加分** | +5 | issue 带 `教学价值高` 标签 + 你的实现确实展示了该 issue 的教学点（在披露段说明） |
| **反思加分** | +5 | 披露写得特别真诚 + 对 AI 协作有具体观察的（不是流水账），老师会主动加这 5 分 |

"老师 review 通过"不等于满分——它只意味着 PR 没被一票否决，可以按上面 7 维打分。

## 一票否决项（直接最高 50 分）

只保留三条真正的红线：

- **故意**违反 [AGENTS.md](AGENTS.md) §4 硬规则（"忘了"或"不知道"会按 -10 处理，不是一票否决）
- AI 披露段完全不填、或与 PR diff 严重不符（按学术不端处理）
- 提交他人 commit 冒充自己

`bun test` 不通过 / 本地与 CI 行为不一致 / 改坏了某个其他 feature——都按"改动正确"维度按程度扣分，不一票否决。

## 协作规范

- 允许跟同学讨论思路。**不允许共享 diff、prompt 文本、或互看对方 code**。被发现互抄 = 双方 0 分。
- 允许 AI 助手帮你写测试，但你 review 后要在披露段里写明哪条测试是 AI 写的。
- 不允许 fork 同学的 PR 改进交。但 6/5 之后欢迎你 fork 主仓库或同学的 fork 继续做。

## FAQ

**Q：术语扫盲**
- `fork`：GitHub 提供的"复制别人仓库到我的账号下"功能；点页面右上角 Fork 按钮即可。
- `feature 分支`：你 fork 内的一个分支，跟 `main` 区分。命名 `feat/xxx` 或 `fix/xxx`。`git checkout -b feat/my-feature`。
- `Conventional Commits`：commit message 用 `<type>(<scope>): <subject>` 格式，type ∈ `{feat, fix, refactor, docs, test, chore}`。例：`feat(player-details): add path history view`。详见 https://www.conventionalcommits.org。
- `bun test`：需要先装 [bun](https://bun.sh)（`curl -fsSL https://bun.sh/install | bash`）。Windows 推荐用 WSL2。

**Q：claim 后做不完了**
答：尽早 `/unclaim` 让别人接。最迟在 deadline 前一天。

**Q：AI 写的代码我没看懂，怎么改？**
答：让 AI 逐行解释给你听，问到懂为止。看懂前不要 commit。如果到最后某些行你仍然觉得"知其然不知其所以然"，在披露段如实写——比假装看懂分更高。

**Q：我跟 AI 吵了半天最后用了它第三版方案，算我的工作吗？**
答：算，而且这就是这门课要练的事。在披露段写出来"前两版为什么不行、第三版怎么改的"反而拿分。

**Q：我做小 issue（难度-轻），披露要写得很多吗？**
答：不用。轻量只要工具+模型+一段 150-300 字反思就够了。中等/架构再补 prompt 节选 + diff 对比。

**Q：我开了 PR 才发现思路错了**
答：close 原 PR、回 issue 评论说明、重新开新 PR。Issue claim 不复位。但每次返工损耗时间，第一次 claim 之前想清楚。

**Q：本地 `bun test` 全过但 CI 挂了**
答：算 CI 挂。在 PR 里说明你看到的本地结果和 CI 错误，老师会判断（一般是环境差异的话不扣硬分；如果是真 bug 当然扣）。

**Q：我手快 claim 了一个超出我能力的架构级 issue**
答：5 天内 `/unclaim` 没事。建议第一次 claim 选`难度-轻`或`难度-中`，先建立信心。

**Q：跑不起本地环境**
答：在 [#1 作业登记帖](../../issues/1) 之外开**新 issue**问，标 `help-wanted`。老师 + 助教看到会回。不要私聊老师。

---

不清楚的事在 [#1 作业登记帖](../../issues/1) 下问；助教/老师会在那回。
