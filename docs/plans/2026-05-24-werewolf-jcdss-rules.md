<!-- review-suggest:skip (already reviewed by 3 parallel agents: spec-completeness, rules-domain, impl-fit; findings incorporated 2026-05-24) -->

# 狼人杀规则对齐京城大师赛 / 竞技标准局 — 设计

> 状态:设计稿 v2(已纳入 3 路评审意见)。下一步:用户过目 → 实现计划。
> 涉及代码:`convex/ours/interactions/werewolf/{state,rules,prompts,index}.ts` + `convex/tests/werewolf-rules.test.ts`

## 1. 背景与目标

当前狼人杀是 9 人局(3狼/预言家·女巫·猎人/3民),硬机制已贴近现代屠边标准。但**流程规则**与**信息披露**偏离京城大师赛 / 竞技标准局(预女猎守),手感不对。目标:对齐预女猎守竞技标准,支持 **9 人**与 **12 人**两套板子。

> 现状校正(评审发现):现有代码**只在白天放逐时**入遗言队列(`rules.ts` 唯一的 `lastWordsQueue.push` 在 day-resolve),**夜死目前根本没有遗言**。所以 §5 是"**新增首夜夜死遗言**",不是"移除非首夜遗言"。

## 2. 板子(两套,按人数选)

| 板子 | 狼 | 神 | 民 | 胜负 |
|---|---|---|---|---|
| **9 人(预女猎,无守卫)** | 3 | 预言家·女巫·猎人(3) | 3 | 屠边 |
| **12 人(预女猎守)** | 4 | 预言家·女巫·猎人·守卫(4) | 4 | 屠边 |

- **9 人沿用现有均衡的 3狼/3神/3民 预女猎,不加守卫**(roster 不变);**守卫只在 12 人局**。
- 按人数索引的 board 配置表;非 9/12 保留现有 fallback。`index.ts` 已设 `maxPlayers: 12`(已通)。
- 屠边 `checkWin`:神 = 现存神职(预/女/猎,**12 人含守卫**),按"非狼非民"通用计数,**自动适配两板**(神全灭=屠神边;民全灭=屠民边;狼全灭=好人胜)。

## 3. 守卫(新角色 `guard`)

> **守卫只出现在 12 人局**;9 人局无守卫,`night-guard` 阶段对其直接 skip(见 §8 skip 逻辑),夜间结算的 `guarded` 恒为 false、退化为现有的救/毒逻辑。

### 夜晚顺序(新增 `night-guard`,改为标准唤醒序)
`night-guard → night-werewolf → night-witch → night-seer → night-resolve`
- 守卫**盲守**(先于狼,不知刀口);女巫在狼之后(见刀口),预言家在女巫之后(标准序,评审纠正)。
- `planNextTurn` 必须处理**守卫死亡/无守卫**时发系统回合直推 `night-werewolf`(镜像现有 seer/witch 的 skip 逻辑 `rules.ts:263-266`),否则夜晚循环卡死。

### 守卫规则
- **不能连守同一人**(记 `lastGuardTarget`;违规按空守处理)、**可自守**、**可空守**。

### 结算(`night-resolve`)— 需重写刀口结算,非自动涌现
现有 `rules.ts:435`:`if (pendingWolfKill && !witchSaveUsedTonight) deaths.push(...)` —— 救会**取消**死亡。奶穿要求相反,必须改为三输入结算:

```
guarded = (guardTargetThisNight === pendingWolfKill)
saved   = (witchSaveUsedTonight 且女巫救的是刀口)
killed  = pendingWolfKill && !(guarded XOR saved)   // 都有(奶穿)或都无 → 死
```

| 守 | 救 | 结果 | 死因 / 猎人 |
|---|---|---|---|
| 否 | 否 | T 死 | 狼刀 → 可开枪 |
| 是 | 否 | T 活 | — |
| 否 | 是 | T 活 | — |
| 是 | 是 | **T 死(奶穿)** | 算**狼刀** → 可开枪;解药**消耗且浪费** |

- 毒目标:**毒路径保持不变**(无条件入 `deaths` 且入 `poisonedThisNight`),毒穿守卫盾 → 死、算**毒** → 猎人**不可**开枪。
- 关键:奶穿致死**不写**进 `poisonedThisNight`,沿用现有 `if (!poisoned ...)` 让猎人可开枪。但**前提**是先让奶穿目标进 `deaths`——这正是上面的三输入重写,别只改 poison 列。

## 4. 发言顺序(死左/死右)

**决策(已定):警长显式选方向 + 无警长引擎兜底。**

新增 `day-direction` 阶段(`day-speak` 前):
- **有警长存活**:给警长一个 AI 决策回合:
  - **恰好一人**昨夜死亡 → 选 **死左 / 死右**(从该死者左/右顺位起)。
  - **平安夜(0 死)或 ≥2 人死亡** → 选 **警左 / 警右**(评审纠正:双死时死左死右有歧义,标准回退警左/警右)。
- **无警长**(流警/撕警徽):跳过该回合(`planNextTurn` 发系统回合,镜像 `sheriff-pull-vote` 无警长分支 `rules.ts:354-357`),引擎兜底:恰好一人死→从死者下一顺位按座号递增(死右等价);否则从座号 0 的下一存活者起。固定可复现,§10 测试钉死。
- 警长**归票最后发言**:沿用现有 `sheriff-pull-vote`,不变。

**speechOrder 实现要点(评审)**:
- 在**夜间遗言 + 猎人开枪全部结算之后**才快照 `speechOrder: Id[]`(否则含已死者);锚点用现有 `nightDeaths`(白天有效)。
- `day-speak` 按"`speechOrder` 中下一个仍在 `alive` 的人"推进(**跳过已死**),用独立 `speechCursor`,不要复用 day-vote 的 `cursor`(长度不同,易索引漂移)。
- 猎人夜死返回路径:`phaseAfterHunterShot` 现仅 `'day-speak'|'night-werewolf'`;夜死猎人开枪后须仍经过方向计算(把 speechOrder 在 night-resolve 后统一算好并存,hunter-shoot 返回 day-speak 时直接用)。

## 5. 遗言不对称 + 夜死警长警徽

- **仅首夜死亡有遗言**(`day === 0` 时的 night-resolve;评审验证此判定正确且无 off-by-one——`day` 在 day→night 切换时才 +1)。
- 之后夜死**无遗言**:不入 `lastWordsQueue`(现状即如此,只需**新增**首夜入队)。白天放逐/翻牌**有遗言**(不变)。
- **遗言 ≠ 警徽移交(评审纠正)**:夜死无遗言为真,但**警徽仍要移交**,二者解耦。

### 夜死警长警徽 —— 方案(b)黄昏决策(已定)
标准:警长**因任何原因死亡(含夜刀/被毒)都可移交或撕毁警徽**,不因"夜死无遗言"而强制撕毁。当前代码**只**在白天 last-words 分支处理警徽,且**从不清理夜死警长的 `state.sheriff`**(评审指出:这会在 direction/归票 读 `sheriff` 时变成实 bug)。

**采用(b)黄昏决策**:夜死警长在天亮时获得**一次"传给X / 撕毁"决策**(复用白天 last-words 的警徽逻辑),**不发表遗言**(遗言与警徽移交解耦)。新增一个 `sheriff-night-badge` 决策回合(仅当夜死者中含警长时触发);若该决策缺失/无效目标,默认撕毁。`applyNightResolve`/该回合**必须显式移交或清理** `sheriff` 与 `sheriffHas1_5x`,不留悬空 id。

## 6. 白天平票 PK

- `day-vote` 平票 → 新增 `day-pk-speech` + `day-pk-vote`:平票者再发言一轮 → **台下(`alive \ dayPkCandidates`)重投,PK 者不投** → 仍双平则**当天平安日,无人出局**(复用现有 deadlock 分支 `rules.ts:528-531` 的日志/转移)。
- 1.5 票在 PK 仍生效;**若警长是 PK 者则其不投**,该轮 1.5 票不计——PK 投票统计须判 `sheriff ∈ dayPkCandidates`。
- 镜像现有 sheriff-PK 状态机模式(`dayPkCandidates/dayPkVotes/dayPkActive`)。
- 现有 sheriff-PK "落选者可重投"的偏差(`rules.ts:313-316`)是**正交范围**,评审建议**单独提交**修,不混进本 plan(见 §11)。

## 7. 信息披露修正

- **预言家只验阵营**:`prompts.ts:169`、`:363` 现渲染具体角色(`= witch`)。评审确认仅此两处读 `seerKnowledge.role`。**采用"写入即存阵营"**(peek 时存 `'werewolf' | 'good'`,`rules.ts:622-624`),从结构上杜绝泄漏,优于渲染层转换。实现前**全仓 grep** `seerKnowledge` 确认无其他消费者(spectator/debug)。
- **死亡不公布角色**:公共死亡公告已干净;自爆翻牌/猎人开枪为规则规定的主动暴露,保留。新增阶段不得引入泄漏——加测试守住。

## 8. 新增状态与阶段汇总

**新增 phase**:`night-guard`、`sheriff-night-badge`(夜死警长黄昏决策)、`day-direction`、`day-pk-speech`、`day-pk-vote`。`initialState.phase` 改为 `night-guard`。

**新增 state 字段**(`state.ts`):
- `WerewolfRole` 加 `'guard'`。
- `lastGuardTarget?`、`guardTargetThisNight?`
- `speechDirection?`、`speechOrder?: Id[]`、`speechCursor?: number`
- `dayPkCandidates?`、`dayPkVotes?`、`dayPkActive?`
- `sheriffBadgeDirective?`(若选 §5 方案 a)
- seer 存储改 `seerKnowledge: { target; alignment: 'werewolf'|'good'; day }`

**高风险实现清单(评审,易漏的静默 bug)**:
- 每个新字段都要加进 `clone()`(`rules.ts:34-67`)与**全部 reset 块**(initialState、夜间 reset `rules.ts:220-226`、自爆 reset `rules.ts:578-581`),否则跨夜泄漏或被静默丢弃。
- `lastGuardTarget = guardTargetThisNight`(结算时轮转)、`guardTargetThisNight` 每夜清空。
- `applyNightResolve` 清理夜死警长的 `sheriff`/`sheriffHas1_5x`(见 §5)。
- `planNextTurn` 加 `night-guard`(无守卫跳过)与 `day-direction`(无警长跳过)的 skip 分支。

## 9. 不在范围内

- **白痴**(预女猎白)——只做预女猎守。
- **警徽流"预言家两夜验人约定"**(先验A后验B的传递策略)——prompt 点到为止,不编码强制。注意:§5 的**警徽移交本身在范围内**(夜死警长要能传/撕);不在范围的是预言家如何用它传信息的策略层。
- **限时发言 / 积分系统**——AI 局不需要。
- **sheriff-PK 落选者重投修正**——正交,单独提交。
- **12 人入局编排**(`seedTwinsForGame` 稳定产出 12 persona)——实现时验证,有问题单列。

## 10. 测试计划

扩展 `convex/tests/werewolf-rules.test.ts`:
- 板子分配:9 人=3狼/3神(预女猎)/3民**无守卫**;12 人=4狼/4神(含守卫)/4民。屠边边界两板各自正确。
- 守卫:不能连守(拒)、可自守、**奶穿(守+救→死且猎人可开枪)**、**同守同毒(死且猎人不可开枪)**、只守/只救存活。
- 发言顺序:有警长死左/死右;**双死→警左/警右**;平安夜→警左/警右;无警长兜底顺序确定。
- 遗言:**首夜夜死有遗言**;**第二晚夜死遗言队列为空**(钉死 off-by-one);白天放逐有遗言。
- 夜死警长警徽:按所选方案验证(移交后继任/撕毁后无警长),且 `sheriff` 不留悬空。
- 白天 PK:平票进 PK、台下重投 PK 者不投、双平平安日。
- 预言家:查验记录只出金水/查杀。
- 回归:自爆、女巫、猎人、警徽流(白天)测试不破。

## 11. 实现分单(评审建议,按风险拆)

按依赖与风险拆成可独立测试的单元,逐个 TDD:
1. **守卫 + 夜间结算重写**(最高风险:动 `applyNightResolve` 这个最承重的函数 + 改 checkWin + 加角色)——以奶穿/毒穿真值表为测试规格,先做。
2. **发言顺序 + speechOrder**(中:侵入 day-speak 游标模型,牵连 hunter 返回路径)。
3. **白天 PK**(低中:镜像现有模式)。
4. **预言家只验阵营**(低:`prompts.ts` + peek 写入点)。
- **夜死警长警徽**(§5,已定方案 b 黄昏决策):新增 `sheriff-night-badge` 回合,复用白天警徽逻辑;并入单元 2(发言顺序/警长相关)。
- sheriff-PK 落选者重投修正:独立提交,不在以上四单元内。
