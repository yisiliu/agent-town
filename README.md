# agent-town

Agent-town 是 [a16z ai-town](https://github.com/a16z-infra/ai-town) 的中文课堂 fork。学生通过上传 `card.md` 注册数字分身，引擎依据卡片驱动 agent 在 2D 小镇中行动、对话与反思。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Backend: Convex](https://img.shields.io/badge/backend-Convex-blue)](https://convex.dev)
[![Forked from a16z-infra/ai-town (MIT)](https://img.shields.io/badge/fork%20of-a16z%2Fai--town%20(MIT)-purple)](https://github.com/a16z-infra/ai-town)

## 与上游的差异

- 中文化：对话、UI、prompt 模板全部中文。
- LLM 替换：对话走 DeepSeek V4 Pro/Flash，embedding 走 MiniMax `embo-01`，注入扫描走 Together `Llama-Guard-3-8B`。
- 学生与教师界面：独立的 Next.js shell 提供 `card.md` 上传 (`/upload`)、与自身分身私聊 (`/chat`)、教师控制台 (`/instructor`)。
- 双档运行节奏：worldState `live` 时 `stepDuration = 2500 ms`，`frozen` 时 `30000 ms`。教师通过 `/instructor` 切换。
- 引擎自愈：watchdog cron 检测 `engine.generationNumber` 在 120 秒内未推进时执行 stop+start 重启，覆盖 Convex transient 导致 self-scheduling action 链断裂的失败模式（详见 `docs/working-notes/engine-freeze-rca.md`）。

## 仓库结构

```
convex/        共享 Convex 后端
  aiTown/      上游 ai-town 引擎（修改受 ai-town-fork/UPSTREAM_FILES.txt 约束）
  agent/       上游 LLM 对话与记忆
  ours/        本 fork 的所有新增：tables / queries / mutations / actions / crons / lib
ai-town-fork/  Vite + Pixi 2D 前端（连接同一 Convex 部署）
shell/         Next.js 前端：/upload, /chat, /instructor, /spec
data/          地图与 spritesheet
docs/          扩展文档；docs/running-locally.md 为完整搭建指南
scripts/       upstream 同步脚本与 patches/
fixtures/      测试用 card.md 样本
tests/         vitest 集成测试
```

## 快速开始

完整步骤见 [`docs/running-locally.md`](docs/running-locally.md)。最短路径：

```bash
git clone https://github.com/<your-fork>/agent-town   # 替换为你 fork 后的 URL
cd agent-town
bun install
bunx convex dev                          # 终端 1：保持运行
bunx convex env set DEEPSEEK_API_KEY ... # 终端 2
bunx convex env set TOGETHER_API_KEY ...
cd shell && bun dev                      # 终端 3：http://localhost:3000
cd ai-town-fork && bunx vite             # 终端 4：http://localhost:5173/ai-town
```

需要的账号：Convex、DeepSeek、MiniMax、Together。预算与限速说明见 `docs/running-locally.md` §10。

## 贡献

本项目设计供学生 fork 后扩展。鼓励使用 AI 编程助手（Claude Code、Cursor、Codex 等）协助开发。

- AI 助手在生成任何代码前应读 [`AGENTS.md`](AGENTS.md)：架构、扩展点、上游 additivity 约束、已知 gotchas、入门改动建议。
- 人类贡献流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md)：branch 命名、commit 格式、PR 检查清单、UPSTREAM_FILES EXEMPT 语法。

## License

本仓库与上游 ai-town 均依 MIT 协议发布。本仓库新增代码的 MIT 声明见 [`LICENSE`](LICENSE)；上游继承文件的 MIT 声明保留于 `ai-town-fork/LICENSE`（Copyright (c) 2023 a16z-infra），具体文件清单见 `ai-town-fork/UPSTREAM_FILES.txt`。

## Acknowledgments

- [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town)：上游引擎。
- [Convex](https://convex.dev)：实时后端与 scheduler。
- [DeepSeek](https://platform.deepseek.com)、[MiniMax](https://platform.minimaxi.com)、[Together](https://together.ai)：模型 API。
