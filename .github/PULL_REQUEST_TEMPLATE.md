<!--
课堂作业的同学：本 template 与 ASSIGNMENT.md 配套，逐项填齐。
非作业 PR 可删掉 "AI 使用披露" 以下的内容。
-->

## 关联 issue

Closes #<issue 编号>

<!-- 如果是自提议选题，写 "self-proposed, see #<提议 issue 号>" -->

## 这个 PR 做了什么

<!-- 1-3 句话。何变更，为何。 -->

## 怎么验证

<!-- 让 reviewer 5 分钟能复现的步骤。具体到命令、URL、点哪。

示例：
1. `cd shell && bun dev`
2. 打开 http://localhost:3000/instructor
3. 点"清空所有对话"
4. 切到 ai-town-fork 浏览器 tab，应看到所有对话气泡消失
-->

## 跑过的测试

<!-- 贴实际输出，至少 bun test 那段。改了前端贴 bun run build 那段。 -->

```
$ bun test
...
```

---

## AI 使用披露

<!--
课堂作业必填。详见 ASSIGNMENT.md "AI 使用要求"。

📌 `难度-轻` 的同学：只需填 "工具 + 模型" + "反思"。下面的 "Prompt 节选" / "AI 写的 vs 我改的" / "AI 犯的错" 整段都可以删掉。

📌 `难度-中` / `难度-架构`：全部填。
-->

### 工具 + 模型

<!-- 例：Claude Code, Claude Sonnet 4.6 / Cursor, GPT-5.4 thinking -->

### 反思（150-300 字，所有难度都填）

<!--
- AI 帮你最关键的一步是什么？
- 你 review 时改了什么、加了什么？
- 哪里跟 AI 来回讨论了几轮、为什么？
- 整体感觉：这次协作哪里顺、哪里别扭？

诚实记录比"流水账"分高，比"假装一切完美"分高得多。
-->

### Prompt 节选（`难度-中` / `难度-架构` 必填，`难度-轻` 可选）

<!--
至少 2 段。不需要完整 transcript，节选关键的几句就行。可贴成：

> 我的 prompt：把 PlayerDetails 加一个"最近移动轨迹"区块，读 historicalLocations
>
> AI 回应（节选）：
> ```
> ... AI 的回答 ...
> ```
-->

### AI 写的 vs 我改的（`难度-中` / `难度-架构` 必填）

<!--
至少 1 段。AI 原始输出 vs 你最终 commit 的 diff，说明你为什么改。可贴成：

AI 原始：
```ts
const others = [...world.players.values()].filter((p) => p.id !== me.id);
```

我改成：
```ts
const others = [...world.players.values()]
  .filter((p) => p.id !== me.id)
  .filter((p) => game.playerDescriptions.has(p.id));  // 过滤掉只有 player 没有 description 的幽灵行
```

理由：实际跑发现有几个 player 没对应 description（参考 AGENTS.md §7.3），AI 没考虑这个 edge case。
-->

### AI 犯的错 / 我的 review 方法（二选一）

<!--
两个分支选一个写：

A. **遇到了 AI 明显犯错** → 举一个具体例子：
   "AI 用了 `world.players.find` 但忘了过滤已 leave 的 player，
    我加上 `.filter(p => game.playerDescriptions.has(p.id))`。"

B. **没遇到** → 写一句你是怎么 review 的：
   "我让 AI 把每个 commit 的改动逐行解释一遍，并跑 bun test 验证。"

两者都没有 = 你大概没 review。
-->

### `git log` 输出

<!--
跑：

  git log --author='<你的 git config user.name 或 email>' --pretty=oneline main..HEAD

例：git log --author='zhangsan' --pretty=oneline main..HEAD
或：git log --author='zhangsan@stu.example.edu' --pretty=oneline main..HEAD

不确定填什么？用 `git config user.name` 看你的 commit author。

如果你的 commits 同时混了多个 author（比如 fork 后忘改 git config）：
- 列出所有 author：`git log --pretty=format:'%an <%ae>' main..HEAD | sort -u`
- 在下面贴齐，并说明哪些是你自己的。
-->

```
$ git log --author='...' --pretty=oneline main..HEAD
...
```

---

## Checklist

- [ ] 我读了 [`AGENTS.md`](../AGENTS.md)，特别是 §4 硬规则和 §7 已知 gotchas
- [ ] 没有提交 `.env*`、密钥、生产 deployment URL
- [ ] 没有直接 `ctx.db.patch` 修改 `convex/aiTown/*` 表（参见 AGENTS.md §4.2）
- [ ] 如改了上游文件：`ai-town-fork/UPSTREAM_FILES.txt` 加了 `# EXEMPT: <reason>`
- [ ] 已在 [#1 作业登记帖](../../issues/1) 登记 PR 链接 + 学号 + 姓名（**未登记不计成绩**）
