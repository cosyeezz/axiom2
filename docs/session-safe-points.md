# 会话安全点统一契约

当前实现以 Pi 1.1.0 的原生生命周期为准。统一入口为 [session-safe-point.ts](../app/src/server/session-safe-point.ts)：`sessionSafePoint(source, state).allows(operation)` 集中判断时机，`installSessionSafePointHooks` 集中安装模型请求、下一轮准备和整批工具提交后的钩子。消费者不能再自行用 `!isStreaming`、单个工具结束或任意 `atSafePoint: true` 声明授权。

安全点不是“所有事情都能做”的布尔值。必须同时说明**边界来源、提交阶段和操作**；返回的能力仅供当前串行操作使用，不是长期锁，也不能跨异步等待后当作新的准入。IPC 只排队意图，不能在 IPC 回调里直接应用模型或摘要。

## 阶段与准入

| 阶段 | 可信来源 | 允许的操作 |
| --- | --- | --- |
| `boundary` | Pi 扩展 `turn_end` / `agent_before_settle` | 快照；`completed` 时追加压缩记忆提醒；仅 `completed` 且没有已有草稿时返回压缩草稿 |
| `after-turn` | `await` 原生 `finishTurn` 返回之后 | 模型选择、关联网络重绑、请求重载暂停；不要求回合成功，保留错误后的原生恢复 |
| `before-next-turn` | Pi 原生 `prepareNextTurnWithContext` 调用之前 | 补应用晚到的模型选择、网络重绑，早于原生窗口检查和准备 |
| `before-request` | Pi 低层 `prompt` / `continue` 的原生调用入口 | 没有低层在途流或压缩时，补应用模型选择及网络重绑，再放行请求；不是对低层 idle 的任意轮询 |
| `idle` | 外层拥有 Session，并已等待旧 prompt 及 `waitForIdle()` 结算 | 快照、直接应用压缩、模型选择、完整或仅技能资源重载、网络重绑 |
| `released` | 协调器确认没有活动执行，保活 worker 与关闭钩子也已交还写入权 | 同步取快照或直接应用压缩；从复核到追加之间不能 `await` |
| `worker-idle` | 独立记忆／标题 worker 的串行请求间隔 | 只允许该进程的网络重绑，不授权修改主 Session |

取消／中止、资源与模型变更中的请求禁入由统一规则处理。输入关闭或子任务阶段正在过渡时，不再切模型／在回合内暂停重载；已经进入 Pi 的请求生命周期仍按原生 abort 和外层阶段循环交接，不能把迟到的阶段变化变成新的执行失败。压缩收尾及已独占 idle 的资源工作仍可完成。真正资源重载必须等 Session idle，不能在工具批次钩子内直接 `reload()`。

`boundary` 快照能力本身不要求 `completed`，保留子会话对失败历史的既有行为；运行中的主会话还必须满足业务条件：提醒已进入真实请求，并到达完成边界。压缩应用与提醒均不在 error/aborted 草稿边界推进。历史上存在失败消息或未配对工具，不等于当前没有安全点。已停止（包括完成、取消、失败）的主会话不再为压缩启动记忆维护请求：释放保活 worker、等待关闭钩子交还写入权后，在 `released` 阶段直接快照当前全部历史，并直接应用摘要；释放期间若有后继执行则重新交给活动 worker。真实请求前缀之后的已保存尾部也纳入快照，不为获取缓存前缀而重启主会话。压缩以缓存复用最大化为优化目标，不以缓存可复用性作为执行准入：优先保留真实请求的系统、工具和消息前缀并追加摘要指令；前缀缺失、历史投影或原生摘要格式变化时，直接使用当前有效快照的 Pi 原生摘要请求继续。采样字段、服务等级、缓存关闭、请求体或请求头钩子以及本地窗口粗估不再触发压缩专属拒绝；参数与窗口的实际兼容性由 SDK／供应商请求处理。相同配置下保留真实请求的动态采样与缓存选项；配置变化时使用当前配置，不把旧动态覆盖强加给新模型。旧 sidecar 的不可复用原因不阻止压缩。缓存是否命中由供应商决定，失败请求仍按真实结果记账，不能伪报缓存收益或摘要成功。`released` 快照固定携带 `summarizeAll`：原生摘要准备阶段纳入全部当前有效对话（包括最后回复），继承既有摘要，不重新展开已归档或已省略消息；摘要产物不保留快照内的未压缩尾部，快照后新增内容仍保留。不能仅依赖 `keepRecentTokens: 0`，Pi 仍可能选择保留最后切点。

极少历史（例如当前有效上下文仅有一条 user 消息，尚无模型回复）仍可能被 Pi 在扩展钩子之前以 `Nothing to compact (session too small)` 拒绝。本实现保留原生准备与失败语义，不为绕过此限制启动主会话或伪造消息；明确失败不等于等待下一个安全点。

## Pi 顺序不能互换

```text
模型响应 → 全部工具及结果
  → 扩展 turn_end（可返回尚未提交的 drafts）
  → Pi 提交 drafts、更新 context、发 entry_appended
  → 原生 finishTurn 返回
  → after-turn：应用模型选择，或请求暂停重载
  → 原生队列／下一轮准备／请求
```

`agent_before_settle` 也先派发草稿，再提交，必要时继续请求。它执行时低层 agent 可能已停止，但整个 Session 尚未结算。`message_end`、`tool_execution_end`、公开流式 `turn_end`、`agent_end` 都不能替代上述提交位置；单个工具结束不代表整个工具批次结束。

不能只装一个钩子：`prepareNextTurnWithContext` 不覆盖新 prompt/continue 的首轮；异常兜底和原生重试可能不经过正常 finish 路径；两轮之间还可能收到新的选择。因此保留全部原生入口，在同一个模块规定顺序。Session 的活动标记在原生续接／重试之间可能仍为真，不能把 `session.isStreaming === false` 作为全部模型切换的必要条件。

重载暂停在提交后调用 `session.abort()` 并返回 `end`，**不在 finish 钩子里等待 abort**，否则会等待自己所在的生命周期。外层退出旧 prompt、等待 abort 与 `waitForIdle()` 后再重载；需要继续时使用原生续接，不造新的业务执行。

## 消费者盘点与业务边界

| 消费者 | 统一规则之外保留的职责 |
| --- | --- |
| [agent-worker.ts](../app/src/server/agent-worker.ts) 模型切换 | pending revision 合并、离线刷新私有配置、应用选择、请求归因、供应商撤权；切换本身不探测模型、不额外请求／生成摘要，不以认证、图片、等级或容量拒切。配置异常仅影响下一次真实请求，无后续请求不使已完成回答失败 |
| 同文件压缩与 [compression-memory.ts](../app/src/server/compression-memory.ts) | 提醒去重及真实送达、取消确认、快照、草稿、`entry_appended` 与磁盘提交确认、关闭时交接；不验证模型是否真的维护过记忆 |
| 同文件资源重载与 [skill-discovery.ts](../app/src/server/skill-discovery.ts) | 暂停／恢复、资源加载、选择 CAS、失败不发布；技能单项更新不重连 MCP 或扩展 |
| [compressions.ts](../app/src/server/compressions.ts) | 活动 worker IPC 路由、保活释放、单写者复核；摘要产物校验、幂等、取消和落盘确认不由安全点模块替代 |
| [model-proxy-env.ts](../app/src/server/integrations/model-proxy-env.ts) | 首次绑定无需能力，同配置不变；改变配置必须取得 `network-rebind` 能力，先构造新 dispatcher 再切换，旧连接优雅关闭，不静默退直连 |
| [memory-worker.ts](../app/src/server/memory-worker.ts) | 以本进程的实际请求在途状态获得 `worker-idle` 能力，不等待主会话 idle |
| [memory-topics.ts](../app/src/server/memory-topics.ts) | 初始化或原生请求准备时，在现有唯一写者内补缺失目录；沿用当前分支快照，不另设轮询或目录更新调度器 |

压缩的安全时机与产物有效性分开。[compression-context.ts](../app/src/server/compression-context.ts) 继续校验真实会话身份、产物基本合法性、原本成对工具不被新切开、幂等及新增消息保留；不恢复旧的快照字节前缀／编辑兼容拦截。快照后先有新的原生压缩时，迟到 Axiom 摘要失效，详见 [Pi 原生压缩兜底](pi-native-compaction.md)。

## 不属于同一个屏障的机制

- Steering、子任务完成通知、预算告警和总结恢复交给 **Pi 原生队列／阶段串行化**，保留各自持久化回执和过渡确认，不在流式回调中绕过队列修改上下文。本模块不再造一套消息调度器。
- **组件卸载和删除没有全局维护门禁**：不预约新工作准入、不等待主任务或子任务排空，也不清退、停止或重载 Agent worker。组件按各自互斥、revision、确认范围与路径归属校验直接移除文件；正在使用这些资源的任务自行处理资源缺失。它不依赖 `sessionSafePoint`，也不限制发消息、模型选择、任务追加或资源操作。
- 执行池 IPC idle／cleaned 是租约归还确认；会话历史改写的空闲／修订检查是业务所有权准入；后台查询、记忆整理和标题各有独立租约。它们不因主会话正在工作而统一等待。

## 验证与旧说明

缓存优先、移除缓存前置拦截这一轮仅更新了实现与测试用例源码，并做只读静态审查；按用户自行验证的要求，未运行测试、类型检查或构建，也未重启后台。下述通过数量是此前安全点实现的历史结果，不代表本轮缓存策略已通过运行验证。

[session-safe-point.test.ts](../app/tests/session-safe-point.test.ts) 覆盖准入矩阵、取消／阶段／写入权、原生入口顺序和重载暂停。真实 Pi 回环回归复用 `model-switch-safe-point.test.ts`、`compression.test.ts`、`compression-memory.integration.test.ts`、`session-reload.test.ts` 和 `skill-discovery.test.ts`，核对整批工具、切模与网络、草稿提交、空闲无额外请求和原生续接。[task-budget-worker.test.ts](../app/tests/task-budget-worker.test.ts) 另覆盖工具运行时排队 reload 后进入无工具总结，要求重载成功回执不丢失，后续仍在同 run 恢复，旧总结 revision 不覆盖新阶段。

本次定向回归共 **121 项通过**：模型／重载／技能／主子压缩 25 项，压缩提醒与上下文／原生兜底／维护屏障 31 项，独立请求与网络／执行池 55 项，安全点与预算阶段 10 项。对最新 worker 快照另复验相关 27 项全部通过，不重复计入 121。全量 TypeScript 与服务端类型检查通过，并在源码副本完成 `npm run build`（类型检查、Vite、服务端编译）；未覆盖原运行产物、未重启后台。回环协议和 mock 钩子时序验证不能替代远端供应商、OAuth 或 UI／真机验收；本次未运行仓库全部测试。

历史 Kiro 检查表及 `docs/evidence/` 的旧调查保留为历史证据，其中的容量／能力拒切、sticky 失败、`atSafePoint` 等文字不是现行契约；当前模型规则以 [design.md](design.md#55-会话模型菜单) 和本文、源码为准。源码变更需要构建并重启后端才能影响已有 worker；资源 reload 不重新加载 worker 模块。
