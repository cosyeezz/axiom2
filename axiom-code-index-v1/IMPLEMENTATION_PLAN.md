# Axiom 原生仓库认知与代码定位实施方案

本文是本功能唯一的实施主方案。目标是在 Axiom 内提供可维护、可恢复的仓库理解和代码定位能力，并在独立验收通过后退出 AOCI 外部依赖。当前交付是方案、目标契约和离线参考材料；产品接入、效果实验和 AOCI 迁移均尚未完成。

本方案依赖项目现行的 `AGENTS.md` 和 `docs/design.md`。这是第一阶段已运行产品之上的后续功能阶段；现有设计的“不做自动长期记忆维护”和子代理四工具白名单必须在阶段0明确协调，不能默默扩权。功能实施时同步修改相关设计正文，README 只描述已实际可用的能力；不修改 `ui/`。本文不把引用包中的任务模板视为当前已经启动实施的授权。

## 0. 已确定的范围与技术选择

### 0.1 交付目标

1. 同一真实工作目录的多个聊天共享索引，服务重启后仍能复用；不同 worktree 不串用。
2. 保留 `symbol → implementation → feature` 三层代码索引：程序生成符号，模型基于实际证据解释行为和功能。
3. 同一数据库补充模块概览和显式契约、约束、设计决定，支持“这个系统怎么组成”和“这次任务应该看哪里”两种读取方式。
4. 变化立即使相关结论失效，在任务稳定点主动维护；查询时可局部补修。失败、取消和断电留下可见待办。
5. 新会话、恢复和压缩后，由宿主按当前上下文重新交付必要认知正文；数据库里有记录不代表模型当前读到了它。
6. 有可验证的备份、导出、重建和回退机制；通过独立质量与无 AOCI 验收后移除运行依赖。

### 0.2 固定选择

| 项目 | 选择 |
|---|---|
| 运行时 | 遵循现有产品 Node >=22.19.0，兼容验证覆盖22.19.0与24；TypeScript、pi 1.1.0；阶段0核实锁文件和所用API，不因本机使用Node 24提高安装门槛 |
| 数据库 | `node:sqlite`，本地磁盘 SQLite + WAL + FULL；独立于会话主库 |
| 服务所有者 | Axiom服务进程中的IndexManager；每个活动indexKey唯一索引worker，同一真实目录的多个入口共享 |
| 模型执行 | 专用、短生命周期 pi locator worker；不复用主会话历史，不占用户 delegate 子任务名额 |
| 解析 | TypeScript Compiler / Language Service，支持 TS/TSX/JS/JSX；其余文本明确降级 |
| 检索 | 确定性词项、路径和符号检索；中文二字切分及标识符拆分；首版不依赖向量库 |
| 文件枚举与搜索 | 共用 FilePolicy 和 Node 文件 API；文本搜索首版是有界字面量搜索，不依赖用户安装 rg |
| 变化检测 | 工具事件 + `fs.watch` 提示 + 内容对账；正确性不依赖 watcher 必达 |
| 写入协议 | 模型提交提案，服务校验完整证据、图约束、版本与 CAS，短事务原子提交 |
| 主 Agent 工具 | `locate_code` 和只读 `repo_overview`；维护由宿主调度，不把内部写入工具交给主 Agent |
| 长期资产 | 语义对象、约束与决定及其证据来源可导出；派生解析/搜索缓存可重建 |

首版不提供任意语言精确语义解析、完整调用图、向量检索、云端团队同步、外部 Agent MCP 服务、运行数据库连接或表结构自动索引。SQL/迁移文件可作为文本证据，但不能据此声称数据库运行状态。首版包含右下角Index入口及只读索引浏览器：功能树、已组织流程、条件分支与源码证据逐层查看，并可批注具体位置形成修改请求，见第8.4–8.5节；不增加图谱编辑器或自动推导完整控制流，不重新设计其他页面。

本方案替代的是 Axiom 中使用到的仓库认知与维护工作流，不承诺兼容 AOCI 的全部数据库、治理或外部客户端能力。若移除 AOCI 前发现项目实际依赖首版范围外的能力，该依赖必须列为退出阻断项。

## 1. 当前源码与接入位置

以下是规划时实际检查到的接口形态；它们仍在用户工作区中变化。阶段 0 必须记录 HEAD、未提交 diff 摘要、锁文件摘要及 SDK 版本，并复核这些接线，不能只按行号修改。

| 当前位置 | 当前行为 | 本功能的接入要求 |
|---|---|---|
| `app/src/server/index.ts` | 构造 Store、Agents、Tasks，处理命令与服务关闭 | 构造 IndexManager；注册索引管理命令、关闭/归档/认证撤销处理 |
| `app/src/server/storage.ts` | 已使用 `node:sqlite` 保存应用状态 | 复用私有数据根约定；语义库单独存放，不给聊天主库增加大体量源码投影 |
| `app/src/server/agents.ts`、`agents/runs.ts` | worker IPC、执行归属、事件与最终结算 | 增加可组合监听与 index-call 路由；迟到回包校验 workspace/session/run |
| `app/src/server/tasks.ts` | 给 `agents.onEvent`、`agents.onSettled` 赋值并负责子任务结算 | 不能再用第二次赋值覆盖它；改成有 unsubscribe 的多订阅，逐订阅隔离异常 |
| `app/src/server/agent-worker.ts` | `createAgentSession`、task tools、压缩安全边界与停止 | 主会话注册两个新工具，增加 index IPC；通过请求级上下文 hook 注入概览 |
| `app/src/server/transcript.ts`、`app/src/client/chat/ToolActivity.tsx`、共享消息/事件类型 | 通用工具输出可增量展示；当前worker的工具IPC主要转发content，收起摘要来自参数 | 为索引调用增加受校验的进度字段/投影，复用既有过程行与输出；不能仅返回details就假定摘要会更新 |
| `app/src/client/pages/Workbench.tsx`、`client/chat/Usage.tsx` | 主工作台与输入框下方右侧工具组；实际查看会话可属于另一置顶工作区 | 末尾加Index入口，按实际查看归属打开独立索引浏览器；子会话不自动复制入口或整个视图实例 |
| `app/src/server/agents/resource-identity.ts` | 解析资源/配置身份 | 参考现有身份与配置快照方式，增加独立的索引工作区身份，不混用 session/task ID |
| `app/src/server/compression-context.ts`、`compressions.ts` | 捕获/提交压缩快照，协调活跃与空闲会话 | 只在压缩实际生效后更新交付 generation；索引功能不代替现有压缩提交器 |
| `app/src/server/model-service.ts` | 供应商、凭据、模型快照与配置串行化 | 复用模型解析/认证；`serial()` 是配置锁，不是模型请求并发调度器 |
| `app/src/server/tasks/scheduler.ts` | 用户子任务排队和预算 | locator 使用单独有界队列；不能假设存在可直接复用的全局模型限流器 |
| `app/src/shared/agent.ts` | `Selection={provider,id,thinking}`，现有 usage 视图 | 保持选择对象；locator 请求账单独记事件，再按明确归属汇入宿主统计 |
| 根/app `package.json`、锁文件、`scripts/check-package.mjs` | TypeScript 目前是 devDependency，发布包仅带编译产物等清单 | 运行解析需要把 TypeScript 同步迁入根/app dependencies 并更新锁文件；安装包验收必须实际解析 |

`.pi/mcp.json` 和 `AGENTS.md` 是当前仓库的 AOCI 接入点；业务代码未发现专用 AOCI 调用。技术解绑不等于认知能力替代通过。

### 1.1 已有产品组件

以下是当前源码中的职责分组，不把待实施的索引组件算作现有功能，也不要求为本功能重构这些组件的全部内部实现。

| 组件组 | 当前落点与职责 | 接入时保持的边界 |
|---|---|---|
| 页面与输入 | `client/workspaces`、`client/chat`、`client/tasks`、`drafts.ts`；工作区、聊天、任务及本地草稿 | 展示独立订阅的事实；索引更新不整体刷新页面或接管输入状态 |
| 传输与共享协议 | `client/transport.ts`、`shared/protocol.ts`、共享消息类型；命令、快照与增量订阅 | 浏览器只依赖公开DTO；不能导入索引worker、pi或数据库实现 |
| 宿主组装与命令 | `server/index.ts`；创建服务、接线HTTP/WS、鉴权命令与关闭 | 在此显式组装新模块、注入窄能力；不增加通用服务定位器 |
| 会话与执行 | `Agents`、`AgentRuns`、`AgentViews`、`agent-worker.ts`；run归属、进程、消息投影 | Agents保留主会话执行所有权；索引只接收验证过的事件和调用上下文 |
| 子任务协作 | `Tasks`及records/delivery/scheduler/commands；委派、追问、取消、结果通知 | 保持独立任务事实与队列；locator使用专用队列，不新增伪造子任务 |
| 模型与认证 | `ModelService`、`request-selection.ts`；配置、凭据和冻结Selection | 共享模型选择约定；配置串行锁不能用于等待模型请求 |
| 持久化与恢复 | `Store`、`transcript.ts`、`Compressions`；应用状态、pi JSONL、压缩快照 | JSONL仍是会话恢复来源；单会话单写者，索引DB不成为第二份聊天历史 |
| 本机文件与窗口适配 | `Files`、目录/附件选择、`OpenDialog`、`FileManager`及平台实现 | 平台能力留在适配层；索引证据统一经自己的FilePolicy和证据服务读取 |

当前关闭链包含 `Tasks.close → TaskScheduler.close → Agents.close`，且 Tasks 会设置 Agents 的单一事件/结算回调。新增组件不能再隐式取得 Agents 的关闭权，也不能通过覆盖回调接入；目标组合和分阶段关闭规则见第2节。

## 2. 运行结构与所有权

```text
主 Agent
  ├─ locate_code / repo_overview
  └─ 请求级认知正文（宿主提供；只读子Agent可接收任务范围资料）
                 │ index-call / reply / cancel
Axiom宿主组装入口
  ├─ IndexManager（indexKey资源池、授权入口、准入与撤销排序）
  ├─ LocateCoordinator / Maintenance（用例编排、持久意图与调度）
  ├─ 每 indexKey 唯一 IndexWorker（证据、读取视图、提交、SQLite）
  └─ LocatorScheduler → LocatorRunner → 专用 pi worker（三个内部工具）
```

首版两个新工具只注册到主 Agent。只读调研子 Agent 保留现有 read/grep/find/ls 白名单，宿主可以为它交付已授权任务范围的参考正文，但不允许它创建 locator 或调用索引写入路径。

### 2.1 工作区身份

- `workspaceId` 是应用内工作区标识；`indexKey` 是规范化真实根路径、Git worktree 身份（存在时）及索引格式命名空间的摘要。非 Git 目录同样可用。
- 同一 Axiom 数据根中，相同真实工作目录归为同一索引身份。IndexWorker、数据库写者、语义作者锁、维护合并、缓存容量、后台预算和资源引用计数均以 indexKey 为键；workspaceId/sessionId/runId 只承担授权、执行归属和取消隔离。不同 worktree 即使 Git common dir 相同，也必须隔离。
- 数据放在 `<AXIOM_DATA_DIR>/code-index/<indexKey>/index.sqlite`；路径由宿主计算，模型不能传入 DB 路径、根目录或身份覆盖值。
- v1 依靠已有服务实例锁保证同一数据根单一服务所有者；索引 worker 为唯一写者。另一个 `AXIOM_DATA_DIR` 有独立数据库，不提供跨服务共享同一个 SQLite 文件。
- 工作区迁移/改根先关闭旧 worker，再建立新身份；已有知识只可经导入候选核验复用。归档停止新任务，删除聊天不删除工作区知识。

### 2.2 生命周期

IndexManager 按 indexKey 惰性打开唯一索引 worker，空闲释放解析器和 watcher，重新打开时先对账。多个 workspaceId 可引用同一实例，不能按入口重复启动作者。一次定位的取消只作用于请求和所属 locator；不销毁共享数据库，也不取消其他会话的请求。

归档先撤销该 workspaceId 的索引准入，使所属浏览绑定失效并取消其在途读取/订阅，取消所属 locator、终止其 job lease，但保留 indexKey 的共享变化与待办，再按第 12.2 节等待已获准短事务的确定结果。现有 Store 归档路径是同步的，接入须在宿主命令层完成异步协调，不能向同步 beforeArchiveWorkspace 回调塞入未等待的 Promise。归档失败时恢复仍合法的准入，成功后保留知识资产；重开先复验真实根身份及源码摘要。同 indexKey 仍有其他合法使用者时保留共享 worker/watcher，后续维护按第 10.2 节重新准入；没有合法使用者时关闭资源并封存待办。

供应商退出或凭据撤销由宿主组装入口组合现有 `ModelService.beforeLogout`，同时覆盖主/子会话、压缩和索引执行；不能另一次赋值覆盖Tasks现有处理。沿用既有confirmed协议，先核对全部受影响执行，再统一执行撤销与取消，不能尚未完成确认检查就局部停止另一组件。IndexManager只接收受影响身份和撤销命令，不持有整个ModelService；后台待办与累计预算保留，恢复必须重新准入。

服务关闭由宿主组装入口显式编排三个阶段：

1. **统一停止新准入。** 在等待异步收尾前，使聊天、子任务、压缩、索引浏览、locator和维护入口进入closing，并使正在等待配置锁或资源名额的旧启动失效；出队或异步返回后仍须复检准入。保留已接受工作的取消、回包、结算和持久化通道。
2. **取消并结算。** 持久化未完成意图，由明确的生命周期所有者停止各worker、取消浏览在途读取/释放订阅、释放保活owner，等待已准入短事务的确定结果和可得计量。必要IPC、订阅及索引账本保持可用；真实用量落盘，无法确认的计量按unknown处理。无法安全补入会话的回执保留session_pending，关闭流程不能抢占transcript写入权。
3. **最后关闭存储。** 确认worker、在飞提交和账本回调不会再写入后，checkpoint/关闭索引DB，再关闭应用Store并释放服务锁。close幂等、有截止时间；超时须撤销迟到工作的执行资格并终止/隔离仍可写入的本地执行，留下可恢复状态，不能在仍可能写入时先关DB或宣称关闭成功。

每项资源只有一个关闭责任者。现有 `Tasks.close → TaskScheduler.close → Agents.close` 须在阶段0纳入上述顺序；若将Agents关闭移交组装入口，必须同时移除Tasks中的对应调用，不能保留两条并行关闭链。现状尚无覆盖新索引服务的统一关闭屏障，所需拆分在实施时完成。崩溃后过期lease变为interrupted，不自动重放旧模型请求或旧提案；前台查询重新发起，后台任务仅在预算及自动维护开关允许时重排。

索引 worker 退出时，主聊天仍可工作；主 Agent 收到明确诊断，可使用现有 read/平台搜索能力，或委派四工具只读调研继续。IndexManager 不把失败的索引答案伪装成成功。

### 2.3 内部 pi 的启动边界

主 Agent 调用 locate_code 后，Axiom 的工具适配器把请求交给绑定调用归属的IndexService；IndexManager提供资源与准入，LocateCoordinator委托IndexWorker检索和验证已有索引，只有需要语义核验时才经LocatorScheduler/LocatorRunner启动专用pi worker。worker 中创建短生命周期内存会话，结束后释放；共享的 IndexWorker 可以继续服务其他请求。因此“工具内部启动”指宿主在工具执行链中调度独立进程，不是主 Agent 自行执行启动命令，也不是创建一项 delegate 子任务。精确位置或有效结果可零模型返回，repo_overview 和自动上下文选择本身不启动 locator。

前台定位、显式初始化、后台维护和导入复核共用受限 LocatorRunner、证据服务及提交协议，但各自保留归属、模型选择和预算。后台维护由宿主持久队列独立触发，不要求主 Agent 再调用一次定位工具，也不借原聊天继续执行。前台过程按第8.3节反馈，后台状态按第13节查询。

### 2.4 目标逻辑组件与责任

逻辑组件、进程和文件目录分别描述职责、运行隔离和代码组织，不能互相代替。下表是一组明确的责任边界，不要求每行都建一个类、接口或独立进程；组件内部优先使用具体模块和函数，避免空壳转发层。

| 组件 | 所在位置与唯一主责 | 依赖与禁止越界 |
|---|---|---|
| IndexManager | 宿主；indexKey资源池、引用计数、有效入口、准入/撤销排序及资源释放 | 只协调身份和生命周期；不解析源码、不写SQL、不解释语义 |
| LocateCoordinator | 宿主；复用读取、必要时执行locator、有限重读/修复、组织提交及回包 | 依赖Worker客户端和Runner窄端口；不自行判断证据有效或绕过最终准入 |
| LocatorScheduler / LocatorRunner | 宿主有界调度＋专用pi进程；优先级、作者名额、执行预算与短会话 | Runner只处理模型执行，不能自行提交正式语义；不依赖完整Agents/Tasks对象 |
| IndexWorker入口 | 每indexKey唯一进程；校验IPC、分派用例、组装内部模块与释放资源 | 只是运行容器；不把全部业务堆入worker事件处理器 |
| SourceEvidence / Parser | IndexWorker；FilePolicy、清单/hash、解析导航、证据分页及ledger | 所有读取同一策略；解析只输出机械事实，不生成职责或行为断言 |
| AuthorizedReadView / Query | IndexWorker；当前披露权限、来源闭包、有效freshness、检索/展开/渲染 | 查询、概览、上下文、缓存回包、导出和提交重放共用；不依赖Runner |
| ProposalValidation / CommitCoordinator | IndexWorker；提案预检、语义hash、双CAS、最终图及统一提交 | 接受宿主准入，所有正式语义写入走同一管线；纯规则只接收普通数据 |
| SqliteIndexStore | IndexWorker；连接、迁移、持久记录及短事务 | 独占SQL与连接；不持事务等待模型/IPC/源码读取，不反向调度业务 |
| Maintenance | 宿主调度＋Worker持久状态；变化意图、稳定点、合并、lease/checkpoint | 与前台共用证据、Runner和提交；不另造语义写入器，不伪造主聊天调用 |
| ContextSelection / DeliveryBridge | IndexWorker有界选择与渲染＋主Agent worker中的会话适配 | pi投影/分支核验留会话适配器；选择器接归一化线索，不读SDK历史或启动维护 |
| UsageAccounting / Projections | Worker持久用量＋宿主/会话账单投影；进度另行投影 | 物理费用独立于语义事务；统计、工具展示和上下文交付各自消费事实，互不充当完成证明 |
| IndexBrowseAdapter / IndexBrowser | 宿主鉴权浏览适配＋客户端工作区视图；树、条件流程、证据导航与批注定位 | 索引侧只拿IndexBrowseService；读取共用AuthorizedReadView/SourceEvidence，不触发Runner，不持管理/关闭能力；用户发送批注复用Composer/useSubmission，不由浏览服务执行修改 |
| AssetOperations / AdminAdapter | Worker资产用例＋宿主鉴权管理入口；诊断、备份、导入导出、重建 | 导入只建候选；正式语义仍走统一提交；完整备份单独授权，CLI不直写活跃DB |

IndexManager、LocateCoordinator和调度器可在同一宿主进程组合，但分别持有资源状态、单次执行状态和队列状态。IndexWorker也可在同一文件中组装多个小模块，不能因此把它们的读写权限混为一个公开对象。

### 2.5 依赖方向与状态所有权

代码依赖由外向内：宿主工具/命令/事件适配器 → 资源协调与用例编排 → 明确端口；IndexWorker用例 → 证据服务、授权读取视图和纯校验规则 → SqliteIndexStore。pi/Node进程/SQLite是边界实现，领域规则不导入它们。模型通过三个受限工具回调Worker是运行消息流，不意味着核心模块需要反向导入pi适配器。装配仅在宿主和worker入口进行，不通过全局容器查找服务。

| 状态 | 权威所有者 | 其他组件如何使用 |
|---|---|---|
| 主会话历史、当前分支与执行写入权 | Agents/所属主worker及既有空闲会话协调器 | 会话适配器核验原生事实；索引不保存第二份正文历史，也不自行append JSONL |
| indexKey资源、入口引用、准入与撤销 | IndexManager | 调用者取得绑定归属的窄能力；释放绑定只移除本入口引用/监听 |
| 前台请求/attempt、队列及作者名额 | LocateCoordinator/LocatorScheduler；可恢复事实进request/job ledger | 重试复用总预算、撤销旧attempt；内存队列不是恢复真值 |
| 已接受但未提交的提案 | IndexWorker当前attempt中的冻结临时草稿 | Runner只返回其digest；草稿丢失或尝试失效不能从最终模型正文补造 |
| 正式语义、证据、jobs/checkpoint、submission | IndexWorker内SqliteIndexStore | 机械更新按自身用例写入；正式语义只由CommitCoordinator原子提交 |
| 浏览绑定与展开/选择/滚动状态 | 宿主签发viewId并校验连接/工作区；客户端仅持该视图的临时导航状态 | 正式图仍归Worker；浏览页不是第二份语义库，切归属或撤权清除正文与游标 |
| 索引批注与正在编辑的意见 | 客户端查看实例＋workspace/session内存状态 | 独立于浏览导航和普通草稿；引用不可变，意见可编辑；发送交给既有会话输入协议，不写索引库 |
| 物理模型用量及revision | 独立usage ledger，仍由IndexWorker写入 | SessionUsageAdapter向单会话写者投递回执；UI或JSONL投影失败不能抹去真实费用 |
| 当前请求焦点、prepared包及交付元数据 | 主worker持有当前分支/generation；Worker持久化有界manifest | 请求桥联合复核；持久included不证明新物理请求已含正文 |

正式语义只设一个提交入口，并不禁止机械失效、待办、用量和交付元数据分别落盘。它们都使用同一受控存储模块，遵守各自事务边界；不得为“统一写入”把真实费用塞进可回滚的语义事务。

每indexKey的语义作者互斥与唯一数据库写者是两项独立约束：前者由Scheduler/Manager控制模型核验与提案执行的准入，后者由IndexWorker/SqliteIndexStore控制落盘。SQLite串行提交不能替代语义作者互斥；作者名额也不是跨模型调用长期持有的数据库事务。

会话写入门是待实现的统一宿主边界，负责owner注册、释放及空闲核对/追加互斥。`agents.active=false`不能证明保活或retiring进程已释放SessionManager；具体交接按第12.3节。SessionUsageAdapter只投递事件回执，`projectSessionUsage`只生成统计；IndexManager不另开SessionManager补账，也不直接给agent_sessions.usage加数。

### 2.6 窄接口、执行身份与跨进程协议

`contracts.ts`集中展示目标契约，生产代码按第16.1节分开公开DTO、私有IPC和本地端口，不将整个文件直接作为浏览器或模型工具的公共导出。

- `IndexService`只给工具适配器提供locate/overview，绑定宿主签发的workspace/session/run/call归属，每次调用及异步准入后仍复验当前授权。`IndexChangeSink`绑定一个indexKey，校验宿主提供的完整变化/run归属；watcher/reconcile不伪造来源run。`IndexAdminService`接独立鉴权管理命令；`IndexResourceOwner`表示整个IndexManager资源池的关闭能力，仅宿主组装入口持有，单indexKey的空闲回收由Manager内部处理。实际注入对象必须只有所需方法，不能把全量Manager做一次类型断言后当作窄接口。
- `IndexBrowseService`绑定已授权工作区、连接和viewId，只提供list/getObject/readSource。它与模型工具IndexService分开，不虚构session/run/toolCall或locator读取ledger；公开DTO用判别联合表达列表、详情片段、流程端点、源码页及错误，详见第8.4节。
- 事实通知使用可组合订阅，返回unsubscribe并隔离同步抛错/异步拒绝；保持既有压缩处理与Tasks结算的必要顺序，索引监听只登记持久意图。index-call及内部工具请求交由唯一宿主路由者管理关联、取消和回包，不能由多个广播监听器竞争处理。完整归属+callId只对应一个待处理请求和一个本地终态；重复/迟到消息不能再次启动执行、重复结算或命中新请求。断连、取消、异常和超时由该路由收尾，提交事实及真实用量仍按各自持久协议处理。
- `LocatorRunnerPort`仅执行一次受限模型尝试。宿主另行绑定`LocatorToolPort`的index_query/code_evidence/index_submit；工具参数不含可覆盖归属的字段，没有通用command、SQL或commit入口。index_submit在Worker冻结唯一草稿，Runner的`LocatorRunResult`只返回acceptedProposalDigest和执行/用量引用，不能返回另一份提案正文；真正提交仍由外层协调，见第7节。Runner实现另经私有宿主桥在每个物理请求发送前预留预算并记账，不能用三个工具或最终usageEventIds代替发送前准入。
- `LocatorExecutionOwner`是判别联合：locate必须包含indexKey/workspace/session/run/原始工具调用ID；bootstrap/maintain/import_review必须包含indexKey/workspace/job及当前lease，不能混用前后台归属。`LocatorAttemptIdentity`另绑定request/attempt/admission和索引、locator进程实例身份；进程重建后旧实例不能恢复工具、提交或上下文投递资格，重复requestId不能代替完整校验。已登记物理请求的真实用量可按独立账务协议核验发送者和modelRequestId后补记，但不能借补账恢复旧执行。
- `LocatorLaunch`是可序列化启动字段；本地`LocatorRunSpec`另带AbortSignal，回调留在本地API。wire只发身份绑定的取消消息、严格操作载荷和结果，不发AbortSignal、函数、SDK对象或数据库句柄。接收端根据实际发送进程与宿主登记表核对身份，不信任消息自行声明的owner。
- 当前`LocatorControlMessage`契约固定三工具请求和取消载荷；阶段0还须冻结启动/回复、activity、物理请求预算预留与用量结算、最终提交准入各类schema和限额，明确请求关联、幂等/序号及错误回包。不将局部类型声明称为完整IPC协议；这些消息同样绑定完整身份，不能出现绕开授权的通用RPC后门。
- `IndexStatus`和`IndexDoctorReport`是有界、按当前授权过滤的明确DTO；unknown用null/明确状态表示，部分已知用量标小计。不能返回任意Record、整库行或原始SQL异常供调用者猜结构。

跨进程和外部输入一律严格运行时校验；TypeScript类型只帮助开发期发现错误，不构成权限证明。持久submission只存稳定SubmissionOwner，暂态lease、进程实例和调用准入另按执行事实管理，不改变历史提交的归属。

### 2.7 关键调用链

前台：工具适配器 → 绑定IndexService → LocateCoordinator → Worker的AuthorizedReadView/Query。可可靠复用即返回；有缺口才向Scheduler申请作者/预算，经Runner执行三个内部工具。模型以completed最终settlement后，协调者用acceptedProposalDigest请求Worker核对本attempt的冻结草稿，再由Worker预检 → Manager串行授予最终准入 → Worker的CommitCoordinator短事务重验CAS/最终图并提交 → 宿主得到确定终态 → AuthorizedReadView按当前依据重新渲染。准入与提交之间不保留跨进程长事务。

后台：变化/结算适配器 → 持久意图和机械失效 → 稳定点/授权/预算准入 → 同一Runner和CommitCoordinator。job lease、覆盖事件高水位与checkpoint属于同次提交条件；不能先把队列标done再提交语义。

上下文：主worker中的SessionFocusAdapter依据有效投影与完整当前分支验证输入、配对和双stamp → 传递短生命周期的归一化词项/路径/对象线索 → Worker中的ContextSelection经AuthorizedReadView选择当前正文 → 请求桥按当前generation/权限复核后附加正文并记录本次交付。SDK对象和完整聊天不进入索引核心；临时线索不写入manifest，第9节的恢复边界不因组件拆分而改变。

费用与进度：Runner每个物理请求先经UsageAccounting持久预留，再发供应商请求并补记reported/unknown；进度、会话账单和工具终态分别投影。观察者异常不能反向决定提交成功、回滚真实用量或阻塞执行清理。

浏览：当前查看归属 → IndexBrowseAdapter验证工作区/连接与viewId → Worker复用AuthorizedReadView生成结构化列表和详情，源码页另复用SourceEvidence的受控读取 → 客户端IndexBrowser投影树与流程。展开、搜索和源码查看均不进入Runner；浏览失效通知独立订阅，不重建聊天或输入组件。

## 3. 语义模型：三层代码 + 模块和知识

### 3.1 对象与边

| 对象 | 作者与含义 | 禁止事项 |
|---|---|---|
| `symbol` | 程序生成的声明/定义及位置；稳定身份与具体 SourceRef 分开 | 模型不能生成符号、猜位置或自行改解析结果 |
| `implementation` | 模型根据源码确认的行为：触发、条件、动作、结果、边界 | 不能按函数数自动拆分，不能包含 implementation |
| `feature` | 已确认的功能组织，可共享子功能与实现 | 目录/README 标题不能证明运行关系 |
| `module` | 模型核实的架构职责、边界与 scope；用于仓库概览 | 目录划分仅作候选，不能靠程序模板生成职责 |
| `knowledge` | 契约、约束、设计决定及其来源 | 不把设计要求写成当前已实现，不编造决定理由 |
| `edge` | 独立版本化关系，可局部追加、退休或恢复 | 不整块覆盖父功能的全部成员 |

关系类型固定如下。SQL 负责存在性，应用校验负责端点类型与全部图规则：

| relation | 允许端点 | 语义 |
|---|---|---|
| `contains` | feature→feature 或 module→module | 组织关系；每种子图禁止环 |
| `uses` | feature→implementation | 功能使用某行为，可用 slot 区分同实现的不同阶段 |
| `code` | implementation→symbol/SourceRef | 行为的当前代码依据 |
| `test` | feature/implementation/knowledge→symbol/SourceRef | 相关测试位置；不证明测试当前已运行通过 |
| `relates` | module→module/feature/implementation | 架构关联，必须解释关系；不是调用边 |
| `applies_to` | knowledge→module/feature/implementation/symbol | 契约或约束适用对象 |
| `contradicts` | knowledge→knowledge | 文档规定与当前观察存在冲突，保留双方依据 |

feature 的执行先后存为 `flows`，引用本 feature 活跃 uses 边的 ID 和直接源码证据，属于已观察到的运行关系；仅有文档要求时保留specified事实和缺口，不能据此生成执行箭头。成员排序、contains 和 relates 都不表示实际执行顺序。步骤身份是uses edgeId/slot，同一implementation在不同阶段出现时保留独立步骤。多条有条件的出边可以显示分支，多条入边可以显示共同后继；文字条件不证明分支互斥、穷尽或并发等待。flows允许有证据的回边，不能强制用无环拓扑排序；它不额外定义入口/出口、调用返回、并发合流或子流程映射。浏览器按第8.4节展示已记录关系，不补造这些语义。

### 3.2 事实、要求与未知

每条事实包含 `assertion=observed|specified`、正文、证据 ID。`observed` 的运行行为需要源码支持；`specified` 表示文档明确要求。测试描述、注释和 README 可证明“文档这样规定”，不能单独证明运行行为成立。

knowledge 另有 `knowledgeType=contract|constraint|decision`、来源和可为空的理由，节点 assertion 必须与其 facts 分类一致，观察和规定拆为不同记录。没有已记录理由时保留 null；模型推断写入 unknowns 或候选说明，不提升为正式决定。现行要求和实现不符时，分别保留两条有来源的记录并建立冲突，不任选其一覆盖。

所有生成内容是检索数据，不改变项目指令优先级、工具权限或用户授权。敏感数据、代码中的提示词、旧索引内的操作指令不成为 locator 指令。

### 3.3 版本、生命周期与覆盖

- `contentRev`：对象正文或关系语义变化才递增；规范化内容 hash 相同则不增。语义 hash 在临时 ID 映射后计算，包含 name/summary/事实正文与分类/boundary/unknowns/逻辑 scope，以及 knowledgeType/assertion/rationale 或关系端点/role/slot/reason 等种类专属正文；排除 evidenceIds、authoritySourceIds、review、coverage、访问与计费元数据。aliases 和无序事实集合按规范键排序；flows 保留显式 before/after，不把数组顺序当流程。重新绑定相同事实的新证据只改变 recordRev；直接 SourceRef 边更换目标按第4.1节处理。
- `recordRev`：正文、review 或生命周期任一持久状态改变时递增；无状态改变的幂等复用不增。所有更新同时校验 expectedContentRev 和 expectedRecordRev，新建时两者均为 null；因此“退休后恢复”也不能让旧提案越过 CAS。依赖默认绑定 contentRev，review/lifecycle 的可用性另验，不以 recordRev 触发全图正文级联。
- `review`：绑定实际读到的 file/scope/object/context 依据，表示核验时观察到什么。文件变为 B，不得自动把核验 A 的 review 改为 B。
- `freshness=current|stale|unresolved` 由服务计算。`current` 只表示相对本次验证依据未发现漂移，不保证未来不变，也不保证模型理解正确。
- 允许披露与 freshness 独立，按调用方当前授权/policy 和必要来源闭包逐次计算。来源被禁止或无法验证访问范围时先隐藏对应记录，不能作为 stale 线索输出；这不删除历史资产，也不把某个入口的限制写成同 indexKey 所有入口共用的全局生命周期。
- `active|retired` 是生命周期。退休必须显式 CAS、原因及依据；恢复必须显式 reactivate。查询只选择 active。相同唯一关系退休后复用原 ID 并显式恢复，不能通过重复 INSERT 绕过。
- `coverage=partial|reviewed_scope` 独立于结果成功和 freshness；`reviewed_scope` 只能在声明 scope 的清单已逐项处理且全部缺口列明时使用，不能称“全仓完整”。
- 一次局部核验不能刷新整个祖先功能的 review。结构上合法的 JSON 不代表事实、summary 或完整性语义正确。

## 4. 存储与长期资产

`contracts.ts` 是目标领域接口，`schema.sql` 是初始目标表结构；均不是现有 Axiom API，也不代替运行时 schema 校验及迁移实现。初始 schema_version=1 只用于新建数据库；生产迁移不得依靠 `CREATE IF NOT EXISTS` 冒充升级。

| 表/资产 | 职责 |
|---|---|
| `meta` | schema、workspace 身份、policy/context hash、观察与语义 epoch |
| `files`、`scopes` | 文件状态和内容摘要，范围定义、成员与内容指纹 |
| `objects`、`links` | 代码三层、模块、知识及关系正文、contentRev/recordRev、review、生命周期 |
| `source_refs`、`evidence_records` | 不可变源码范围及服务签发的范围观察；提案引用在提交时持久化，文件删除后仍可审计 |
| `dependencies` | 反向失效索引；file/scope/object/context 的依赖和核验版本 |
| `request_ledgers` | 本次实际返回给 locator 的证据及读取依据；不承认其他请求的引用 |
| `submissions` | requestId+proposalDigest 的幂等结果与提交记录 |
| `change_events`、`jobs`、`job_groups` | 持久变化、合并维护、租约、整项与单批预算、恢复检查点 |
| `usage_events` | 按物理请求归属的用量事件与宿主入账状态 |
| `deliveries` | 认知正文交付的元数据；不保存第二份对话历史 |
| `import_candidates` | 外来语义候选隔离区，未核验不进正式检索 |
| `query_cache`、`search_terms` | 可丢弃的查询和检索投影 |

外键、WAL、FULL、busy_timeout 在每次建连显式设置。事务中写 objects、links、evidence_records、dependencies、搜索投影、语义 epoch 和 submission 结果；任何一步失败全部回滚。不跨模型调用持有 SQL 事务。semanticEpoch 在可见正文、成员、生命周期、freshness 或覆盖变化时推进，用于拒绝混合概览/缓存；它不等于某个对象的 contentRev。

### 4.1 SourceRef 与符号身份

生产范围固定为零基、半开区间、UTF-16 code unit；输出给用户时由渲染器转换为一基行号。内容 hash 取原始文件字节；解码仅支持有效 UTF-8，BOM、CRLF 和非 BMP 字符有专门测试。

符号身份依据路径、作用域、声明种类与解析器稳定锚点。重载、匿名与同名声明必须能区分或报告歧义；不以行号作主键。确定性重定位成功可保留 symbol ID，无法证明重命名同一性时退休旧符号、新建符号并使相关行为待核验。

代码位置变化不自动改变行为正文。优先关联 symbol，让 SourceRef 更新归于解析和 review；直接指向 SourceRef 的边若目标改变，更新该边 revision，但不凭此递增父 feature 正文版本。

### 4.2 备份、导出和重建

- `rebuild --layer derived` 只重建文件/解析/搜索与查询投影；语义对象、知识、关系、来源、退休记录和未完成任务保留。被语义边引用的 symbol ID 与重定位描述也必须保留，不能先删 symbols 再靠级联清空关系；新解析成功映射回原身份，无法映射的保留旧锚点和 stale/unresolved 并进入显式核验。
- 语义清空使用独立 `reset-semantic`，必须先生成并校验备份，再走项目现有破坏性操作确认流程；不能把它放进普通 rebuild。
- 同机备份使用数据库一致快照或关闭/checkpoint 后复制，禁止仅复制活跃 WAL 模式下的主 DB 文件。它保护知识库及来源元数据，不是源码版本备份。完整备份可能包含当前 policy 已禁止披露的历史记录，只经宿主显式资产管理命令产生和领取，存于当前本地用户权限保护的私有目录；普通索引读取授权不授予整库备份访问，模型索引工具和普通导出不能读取它。本边界不承诺对同一操作系统用户建立文件系统沙箱。
- 恢复先在隔离位置完成完整性/身份检查，再按宿主当前授权、policy 与分析上下文重建可见投影并核验当前文件。备份内旧授权配置、旧缓存、submission 正文和交付标志不能恢复读取权限或 current；过滤完成前不开放查询/注入，模型维护仍受当前预算和开关限制。
- `export` 输出 `axiom-semantic/1` 的 JSON：格式版本、语义对象、显式边端点、被引用符号的重定位描述、scope 定义、持久证据记录及 SourceRef、相对路径、生命周期、排除清单和校验和。checksum 为去除自身字段后规范化 JSON 的 SHA-256；规范化固定为 RFC 8785/JCS，拒绝重复键、非有限数及非法 Unicode，不把 Python 参考 canonical_json 当作跨语言协议。默认不含源码全文、凭据、绝对根路径、聊天正文和请求日志。可选写入 Git 需由用户主动选择。
- 导出与overview一样按当前授权/policy过滤完整依据：不能只隐藏SourceRef却留下泄漏信息的正文。任一必要依据不再允许的对象整体省略，并过滤依赖它的边/flows。过滤后必须验证引用闭包：对象正文采用按 kind 区分的 ExportedObject 联合，每个 edge 对象与 links 恰好一一对应，端点、scope、证据、符号和 SourceRef 引用全部在包内解析；悬空引用使依赖记录也被省略，不能靠删掉必要依据拼出可导出的正文。无法形成合法闭包则拒绝导出。omitted 仅按固定原因码汇总数量，不返回被隐藏对象的 ID、名称、路径、别名或事实。私有一致备份不作为普通导出的降级路径。
- `import` 验证格式、大小、校验和、路径及 ID 映射，只写候选区；scope、对象、边、符号、证据及 SourceRef 分别建立映射，并重写 facts/flows/coverage/authoritySourceIds 中的引用，不能遗留另一个数据库的局部 ID。即使 hash 相同，仍校验当前 policy、上下文和来源。不能导入 current 标志、工具权限或他机交付状态。
- 导出是知识资产；数据库文件和搜索投影是运行资产。schema 升级前备份；未知更高 schema 拒绝写入并可只读诊断。损坏时隔离原文件，尝试最近可验证备份，不静默重置语义。

## 5. 文件策略、解析和证据服务

### 5.1 唯一 FilePolicy

枚举、解析、文本检索、代码证据、overview 和缓存复用使用同一 policy hash。默认排除 `.git`、依赖/构建目录、二进制、凭据与密钥文件、`.aoci`、AOCI 输出索引、索引自身运行目录、评测答案与未来补丁。设计文档和配置有明确的文档/配置类别，不能作为运行实现冒充代码。

当前授权检查覆盖全部索引读取面：按 ID 展开、浏览树/流程/详情及源码预览、检索排序/命中片段、summary/facts/aliases/knowledge、关系说明、导入候选预览及复核输入、submission 重放、诊断和导出。持久保存不代表允许再次披露；被禁止来源污染或来源闭包不明的记录在当前调用方视图中隔离，不能作为 stale 结果、搜索提示或错误详情输出。混合来源记录须基于仍允许来源独立复核并提交后才能重新披露，不能先删引用再沿用正文。缺口只报告不含隐藏对象标识/正文的通用原因和汇总；策略变化同时废弃相关投影、游标和已准备交付，实际模型请求按第9.3节再次过滤。

v1 不跟随符号链接、junction 或 reparse point；返回可见 skip 原因。每次打开前检查授权根和 realpath，防止 `..`、大小写别名及扫描后替换链接。解析器不能执行仓库脚本、配置插件或自定义 loader。

默认单文件 1 MiB、单次证据页 64 KiB；超过限制保留元数据及缺口，支持受控分页或用户调整预算，不静默遗漏。文件清单发现新文件也必须改变相关 scope 指纹。

### 5.2 第一层与分析上下文

首次扫描允许文件并计算内容 hash；TS/JS 使用 Language Service/Compiler 创建声明和定义/引用导航。只读解析 tsconfig、项目内 extends、paths、project references，并把所有实际依赖的配置纳入 context hash。

首版只保证工作区内部可解析引用；外部依赖类型、无法解析的动态 import 或不支持语言明确标 partial。允许读取已安装锁定 TypeScript 的标准库作为解析上下文，不作为项目语义证据；不任意遍历外部 node_modules 或执行解析插件。解析器版本、配置、策略变化必须使相应解析与语义依据失效。

语法错误可返回当前文本和诊断，但不能把旧 AST 标 current。程序提供符号、范围、文本和候选；不得由名称、AST 模板或规则生成 implementation、feature 或知识断言。

### 5.3 证据可见性

code_evidence 返回实际源码文本、SourceRef、scope、版本及每个 operation 的 truncated/nextCursor。只有实际返回的文本范围计入 read ledger；仅列出 ID、摘要、搜索命中前缀或目录，不等于读过整个文件。

read 的行区间和 fetch_ref 的 SourceRef 确定完整请求范围，分页可以在同一行内部结束。服务签发的不透明 cursor 固定原操作参数、原范围、下一 UTF-16 字符位置、requestId/attemptId、授权/policy、analysis context 和依据快照；续页沿用原操作参数，不通过扩大行区间绕过页限额。同一 cursor 重试不能跳过未返回的内容；重复范围在 ledger 中按集合覆盖处理，不能累计成新的已读范围。文件、绑定范围或策略变化时拒绝旧 cursor，返回 FILE_CHANGED/SNAPSHOT_EXPIRED/ACCESS_DENIED 等对应错误，不拼接不同版本。

单次 code_evidence 交付给 locator 的完整文本正文默认不超过64KiB，按UTF-8字节计，包含序列化后的证据元数据；批量operation共享这一额度。服务预留有界元数据/诊断空间，字符切分不能拆开Unicode码点、UTF-16代理对或CRLF，也不插入替换字符或改写换行。每页 source.ref 精确覆盖该页 text，部分页不得沿用整个原请求的范围；跨页只在同一attempt、文件hash下合并实际覆盖区间。只要还有内容、依据未变且额度可用，下一页起点接上本页终点并严格前进；不能因为一行超过64KiB就反复返回同一前缀。

每个输入operation都有对应的结果项。请求范围已完成时 truncated=false 且无 nextCursor；可继续时 truncated=true 且必须给出可推进的 nextCursor；错误、总预算耗尽或单项/批量无法容纳时 truncated=true，返回明确 error 且无 nextCursor。超大批量应在读取前以输入/大小错误拒绝或明确报告未处理项，不静默漏项，也不签发零进展续页。分页完成只证明本次请求范围交付完毕，不自动证明完整文件或搜索范围已经核验。

证据 ID 指向服务签发的 EvidenceRecord：source_range 绑定实际可见 SourceRef；scope_observation 保存检索/清单/变化操作、完整性、scope 定义与内容摘要等观察，供删除或已搜索范围说明使用。范围观察只能证明对应操作结果，不能单独证明运行行为不存在；截断搜索不能证明“未找到”。提交把全部被引用记录及历史来源一起持久化，request ledger 到期清理不删除正式事实的证据。scope 定义采用工作区相对 include/exclude glob，与 FilePolicy 取交集；glob 实现/配置进入分析上下文身份。

批量读取、定义/引用、搜索和 changes 共享权限、大小限制和预算。搜索范围指纹包含文件成员及内容 hash，不能只比较路径列表。分页 cursor 绑定请求、scope、policy 和快照，版本变了即失效。

`references` 只是静态导航结果，不能证明动态调用或完整影响范围。模型需要实际阅读入口、条件和注册关系后才能声明行为。

## 6. 一致性、失效和缓存

### 6.1 正确性边界

源码与 SQLite 不存在跨资源原子快照。所有结果必须携带 ReadToken/SourceRef 作为“本次实际验证的观察”，不能承诺线性一致的整个工作区快照。

一次查询或提交按如下步骤处理：

1. 对允许范围建立文件清单与内容摘要，更新 observed epoch。v1 默认严格对账；mtime/size 只作提示，不作 hash 的替代证明。
2. 冻结本次读到的文件快照、scope 指纹和 analysis context，返回服务签发的 ledger。
3. 按需读取和推理，期间不锁定仓库、不持 SQL 事务。
4. 提交前重新验证已用依据及搜索范围；CAS 校验对象与关系 revision。
5. 事务提交后、返回前再核验关键返回来源；有漂移则将相关对象标为待核验、结果降级或重试，绝不把旧结论挂到新版本。

外部编辑始终可能发生在最后一次检查之后；因此 `current` 只说明本次依据验证通过，主 Agent 修改前仍须 read 目标文件。文件持续变化时返回 stale/unresolved，不循环追赶。

### 6.2 失效传播

依赖记录至少包含支持事实的文件、搜索/注册/自动发现 scope、被引用对象的内容 revision 及分析上下文。服务从实际 ledger 生成，不采信模型自行报出的 hash；首版可保守地把本次读取的全部相关依据绑定到改动对象，后续收窄须另测漏失效。

文件删除、入口替换、注册覆盖、新文件或配置变化会使相关依赖 stale。节点正文不变的复核只更新 review，避免内容版本级联。scope 对账不完整、watcher 溢出、重启尚未核对等状态是 unresolved。

失效由程序比较“核验时绑定的依据”和“当前实际依据”决定，不先请求模型判断代码是否改变：

| 依据 | 当前检查 | 失效范围 |
|---|---|---|
| 文件 | 原始字节内容hash、存在性与授权路径身份 | 直接依赖该文件的事实、关系和来源位置；首版按文件保守失效 |
| 搜索/注册/自动发现scope | 允许文件成员及各成员内容hash | 依赖该范围观察的结论；能检出旧函数未改但入口、新文件或注册覆盖已变 |
| 对象 | contentRev、active状态及有效freshness | 需要该对象作为证明的上层断言和摘要 |
| 分析上下文 | 解析器、配置及policy身份 | 使用该上下文核验的记录与派生投影；披露权限另外逐次检查 |

工具或watcher提示先持久化待核对范围、废弃相关缓存/准备包，在完成核对前不再按current交付。hash确认改变后标stale并产生维护待办；提示无法核实时保持unresolved。若只是mtime变化且全部必要依据复核一致，可恢复current而不调用模型。已知变化和反向依赖失效由程序先完成；模型随后判断语义与关系应保留、更新还是退休，不能把“字节变了”直接等同于“功能改变了”。

判断 current 必须校验必要证明依赖的有效性：对象依赖同时满足 contentRev 一致、端点 active、其自身依据和必要依赖有效，不能仅比较正文版本。implementation 变 stale/unresolved 后，依赖其行为的 feature/module/knowledge 断言及摘要同步失去 current；查询、缓存复用、overview 和自动注入都使用这一有效 freshness，并使受影响的 semanticEpoch/投影失效。正文不因此改写或递增 contentRev；持久 review/状态改变仍按 recordRev 规则处理。

复核确认实现语义未变时，可保持 contentRev；上层只有在自身其他依据也仍有效时才能恢复 current，不能借一次子节点复核刷新整个祖先 review。纯导航/组织关联不自动成为所有内部行为的证明依赖，但摘要实际依赖的行为必须绑定来源或 object 依赖。遍历使用 visited/强连通分量终止环；对象相互引用本身不能证明 current，缺少可核验的真实来源或无法闭合校验时返回 unresolved。

### 6.3 缓存

精确结果缓存 key 包含原始 query、规范化但不改变含义的 hints、workspace、policy、分析配置、提示词/渲染版本。不要去掉否定词、数字、大小写语义或排序假设。同义问法走候选检索，不直接取上次最终答案。

只缓存成功已提交的 ID/revision 及依据；不缓存模型自由文本，不把 partial/not_found/写失败当成功缓存。全局 observed/semantic epoch 变化使最终答案快缓存失效；语义对象仍只按自己的依赖局部维护。命中也执行同一 strict basis 检查。

缓存有容量和 LRU，只影响成本不影响真值。初始每 indexKey 200 条查询缓存、16 MiB；解析和源码快照缓存另设上限。fts/vector 不是首版必需项。

## 7. 提案、事务与复用

内部只有三个工具：

- `index_query`：查询已有对象、正反关系、版本、freshness、缺口；支持分页与按 ID 展开，并返回证据记录到 SourceRef/scope 的映射，便于随后实际读取。映射和摘要不进入本次正文已读证明。
- `code_evidence`：有界批量字面量检索、源码读取、SourceRef 展开、定义/引用、范围变化。
- `index_submit`：每次locator尝试最多接受一份最终提案，返回 `accepted=true, proposalDigest, committed=false`；格式拒绝不算接受，外层执行器负责真正提交。

`IndexProposal`、内部请求及外部结果的具体字段见 `contracts.ts`。生产必须用 TypeBox/等价严格 schema 拒绝未知字段、非法联合、超量数组和无效 ID；类型声明不能替代边界校验。第2.4–2.7节的CommitCoordinator是正式语义提交的唯一执行入口，前台、维护、初始化和导入复核共用下述校验与事务；Query、Runner和管理适配器不能直写正式对象。

index_submit先校验当前归属、attempt准入和严格结构，并要求提案requestId等于端口已绑定requestId，不能用该字段选择另一请求。IndexWorker复制并冻结完整草稿，以临时ID映射前完整IndexProposal的RFC 8785/JCS字节计算SHA-256作为proposalDigest；它与排除证据等字段的语义contentHash不同。冻结后原调用对象的任何修改均不影响该草稿。同一有效attempt再次提交相同digest只返回原回执，不算第二份接受；不同digest拒绝覆盖，当前授权和准入仍需重验。

已接受草稿属于IndexWorker的有界attempt临时状态，唯一权威正文保存在这里，不进入正式对象或submissions，也不作为跨重启自动待提交资产。Runner仅从工具回执取得acceptedProposalDigest，外层在completed最终settlement后核对当前attempt和Worker中的digest，再让CommitCoordinator使用该冻结草稿；提交调用不能另带可替换的提案正文。digest不符、没有已接受草稿、草稿丢失或尝试已撤销时拒绝该提交路径，不能解析最终assistant文本补造或替换草稿。accepted也不证明证据、图或CAS最终校验已通过。

进程退出、attempt撤销或过期后草稿不可再提交；未完成工作保留既有持久待办和真实用量，后续仅按既有重试规则建立新attempt。若提交可能已成功，则按下述submission协议先核对持久提交事实；草稿缺失不能抹去已提交事实，也不能触发已提交请求再次生成模型提案。

### 7.1 固定校验顺序

1. 请求归属、取消、截止时间、工作区授权和提交幂等键。
2. 严格结构、大小、临时 ID、对象种类、操作 ID 冲突与 expectedContentRev/expectedRecordRev；临时 ID 映射后再查一次操作冲突，不能用多个临时 ID 绕过。
3. 每条 assertion/关系的证据已在本次 ledger 实际可见，SourceRef 与 scope 未漂移。
4. 对本批操作叠加后的图做预检，允许同批新增/恢复的端点；端点类型/活跃性、flow 引用当前 feature 活跃边及 contains 无环均须成立。不能仅凭写入前图拒绝合法同批引用。
5. 读取现有候选，检测重复关系和明显相同语义对象；同名不自动合并，不同条件/结果不能强制复用。
6. 计算语义 hash、局部依赖、review、搜索投影与变更预览；CAS 再验。
7. 获得宿主最终提交准入后再获取写事务，以最新已提交图叠加本批新增、修改、退休和恢复，重新校验 CAS、端点种类/生命周期、flow 与 contains 无环等最终图约束；事务外预检不能代替此步骤。校验通过后一次原子写入并记录 submission，只从提交记录渲染结果。事务内不读取源码或等待模型；提交准入与撤销按第 12.2 节排序。

成功 submission 冻结 requestId+proposalDigest 和原提交事实。核验原请求归属后，相同 digest 只复用该事实，不再写入或重复入账；不同 digest 拒绝。submission 的 owner_json 按 SubmissionOwner 持久化宿主签发的 indexKey、workspaceId、purpose 及会话/run或job归属，不能依赖会过期的 request ledger 恢复归属；outcome_json 保留原选择、提交时对象版本与提交事实。对外结果根据原选择的记录重新检查当前授权、生命周期、revision 和依据并渲染；不得原样返回 outcome_json 中的历史正文或把历史成功当作当前正确答案。可见来源减少、所选记录版本变化或依据漂移时返回受限/降级结果，归属或工作区访问失效则拒绝，不披露旧正文；原提交事实保持不变。

结构修复和提交前版本冲突不会预占成功幂等键：外层允许的重新核验建立新 attemptId/ledger，沿用逻辑 requestId 和总预算；新尝试准入前撤销旧尝试的提交资格，旧accepted草稿、ledger及cursor不再可用于提交，迟到回调也不能重新激活它们。旧尝试证据不能充当新尝试已读内容。重连恢复先查 submission，不重新启动已提交请求的 locator。若已有新的物理模型请求实际发生，其用量仍必须入账，幂等写入不能抹去真实费用。等义提案优先复用并保持 revision；程序只能发现疑似重复，不能靠字符串相似度决定语义同一。

每个操作数组内 ID 不得重复；同一 ID 跨 nodes/edges/reviews/retire/reactivate 重复也拒绝，唯一允许的组合是“退休对象正文更新 + reactivate”。该组合只作用于已有 retired 对象，两处 expectedContentRev/expectedRecordRev 必须相同，并共同校验事务前版本；作为一个最终变更只递增一次 recordRev，contentRev 仅随最终正文变化。退休对象改正文必须使用该组合；其他重复、retire 与 reactivate 并存、新建临时 ID 参与生命周期/review 操作均以 INVALID_PROPOSAL 整批拒绝。不得靠数组顺序解释冲突操作。

新节点临时 ID 在事务内一次分配；无变更提案仍允许选择已有节点和刷新 review。省略对象/边、空数组都不代表删除。退休边不删除其他功能共享的实现。退休对象时必须在同批显式处理全部活跃入边和出边；退休关系还须处理活跃 feature 的 flow 引用，否则拒绝整个提交。最终活跃图不能引用退休节点或关系，历史记录保留供审计。

### 7.2 失败规则

| 情况 | 行为 |
|---|---|
| FILE_CHANGED / WORKSPACE_CHANGED / RECORD_CHANGED | 提示当前冲突；总预算内最多一次重新读取/重提，不盲重放旧提案 |
| 纯格式错误 | 最多一次结构修复；不得借修复扩大证据或无限循环 |
| 事实不足、歧义、动态关系未确认 | partial + gaps，不生成已确认事实 |
| 磁盘满、DB 锁超时、事务失败 | maintained=false；不声称已维护，持久待办在能够写入时记录 |
| 取消或超预算 | 停止模型与工具，已提交部分不回滚其他请求；未提交提案不写入 |
| 事务已经提交后取消/回包丢失 | 复用原提交事实，当前答案仍重验归属、权限与依据；不得因未收到就重复生成 |
| 不支持 schema / 损坏 | 隔离索引写入，主任务回退读源码，保留诊断和原资产 |

整个请求最多一次格式修复和一次版本重读，二者都计入请求总 budget；预算不足立即结束。不能为得到漂亮结果增加隐藏重试。

## 8. 主 Agent 工具与结果

### 8.1 locate_code

输入：`{query, hints?:{paths?,symbols?}, cursor?}`。query 必填；hints 只提高优先级，不作为默认硬过滤。模型不能选择他人工作区、服务路径或无限预算。

流程：检索已核验候选 → 精确符号/路径可确定性返回 → 其他语义命中必须检查 query 是否覆盖 → 过时或缺失时调用 locator 局部核验 → 提案校验提交 → 渲染结果。

返回状态：

| status | 含义 |
|---|---|
| `ok` | 已满足本次定位目标，返回有证据的核心位置；不代表完整影响范围 |
| `partial` | 有可用证据但仍存在歧义、缺口或限额；逐项标注 |
| `not_found` | 只在实际完成搜索的声明范围内未找到；给出范围和缺口 |
| `error` | 权限、服务、版本或预算问题导致无法可信完成 |

结果包含 maintained、freshness、readToken、核心/入口/条件/测试位置、功能路径、相关知识和 coverage；所有位置来自实际 SourceRef，相关知识逐条携带 freshness 和来源位置。AI 阅读正文先写结论和可行动入口，再写依据与缺口。最长页默认 4,000 估算 tokens；后续页 cursor 绑定同一查询快照，不能静默截断。

maintained=true 表示输出依赖已提交且当前检查通过，允许零写入复用；它不表示每次调用都生成了新知识。partial 可以含已提交局部记录，但每个位置都要标明其可信边界。

### 8.2 repo_overview

这是只读的概览/按范围展开工具，输入 scopeIds/cursor，不触发新的全仓模型建库。无索引时返回扫描状态和缺口，提示 locator 可继续完成当前任务。默认不会为一次普通聊天自动进行无限建库。

首层固定展示：已核实的系统职责、模块边界、关键关系、外部契约/高影响约束、当前冲突、覆盖清单及未覆盖范围。按模块稳定排序和版本化渲染，不能按最近热门查询排序冒充系统全貌。

一页只声明本页覆盖；pagination 绑定 semantic snapshot、policy 与 renderer 版本。快照失效拒绝 cursor，重新取当前概览。要求完整 scope 时必须读完全部页才可说“已交付该 scope”；不得把截断首屏标完整。

所有能力复用同一套对象、来源和 freshness；不另外维护一份会漂移的仓库说明。

### 8.3 定位过程反馈

locate_code 在现有工具过程行显示一次调用；展开输出可看到真实阶段：排队、检索已有索引、读取证据、分析关系、校验提案、提交及结束结果。直接复用可以跳过模型和提交阶段，不补造完整流程或百分比。展示的是执行事实与简短状态，不转发locator的私有推理、提示词或完整内部对话；不创建delegate任务卡片或子会话。

当前宿主已有通用工具增量输出路径，但工具IPC主要转发content，尚无索引进度字段；收起行目前主要展示工具参数。目标链必须贯通：IndexManager的有序进度快照 → 已校验归属的索引IPC → 工具适配器的onUpdate({content, details: {axiomIndexProgress}}) → pi tool_execution_update → agent-worker白名单投影 → tool IPC → runs.ts → ChatMessage.toolProgress → Tool/ActivityContext。目标新增可选的工具事件及ChatMessage.toolProgress字段，见contracts.ts的IndexToolMessageFields；worker从受信details.axiomIndexProgress校验提取，宿主继续核对完整归属与sequence再投影。content承载有界可读摘要，阶段文案由已校验的结构化事实生成；不解析正文猜阶段、不透传任意details，也不借用thinking字段。

保持原布局与折叠行为。Tool的行内收起文本与其上报ActivityContext的target必须共用同一进度摘要；外层ActivityGroup仍按消息和调用的原始顺序选择摘要，旧调用的迟到进度不能抢占较新调用，每个工具行独立更新。展开输出保留有界阶段摘要，普通工具不改走委派任务事实通道。

最终工具结果替换临时进度，附本次执行摘要，并在details.axiomIndexProgress保存可得的最终快照。tool_execution_end与随后message事件、重开历史必须使用一致的白名单投影规则；transcript.ts的chatMessage()也要从最终工具结果恢复同一toolProgress，不能在消息覆盖时丢弃已持久化字段。终态不能被迟到进度覆盖；若最终元数据缺失或只有中断占位，则只展示可核实的工具终态，索引阶段和计数保持未知，不沿用最后一条running进度或从文本猜测提交成功。不要求持久保存每条流式更新或补造中断前轨迹。

IndexProgress由宿主生成，按逻辑requestId单调递增sequence并带attemptId；IPC另验第12.2节的完整归属。只报告实际发起的定位模型请求数、已交付证据页数及宿主耗时，用量仍走第12.3节账本，不由进度重复入账。内部index_submit接受提案不等于维护成功；只有外层校验/提交完成后才能报告提交事实，完成调用也不等于结果无缺口。失败、取消、中断及提交后丢回包按真实状态呈现。

进度监听的同步异常和Promise拒绝必须隔离；可以合并高频更新，但不能使终态回退，迟到更新不得跨调用或尝试复活。取消/终结后解绑监听，不等待前端确认才提交或释放资源。没有进度回执时保持未知，不用定时器推算阶段；索引错误须按真实工具错误机制返回，不能只把“失败”写进成功结果正文。

### 8.4 Index索引浏览器

这是工作区已提交索引的只读浏览入口，属于本方案首版范围。主工作台输入框下方右侧工具组在现有入口之后增加Index层级图标；沿用当前20px左右图标、至少44×44点击区域、应用提示和选中态，可访问名称为“打开索引浏览器”，提示“Index · 项目索引”。点击只展开/收起浏览视图，不自动建库、核验语义或发起模型请求；既有获准后台维护仍独立运行。无已组织内容、索引禁用、未就绪、连接中断和读取失败分别如实展示，不用示例数据填充产品。

**布局与导航。** 桌面从右侧展开较宽的非模态浏览面板，顶部显示实际工作区名称、搜索、返回/关闭；左侧索引树，中间选中功能的关系流程，右侧步骤/条件详情。宽度不足时详情移到下方；窄屏按“索引树 → 功能流程 → 详情”单栏切换，保留明确返回路径。大图只在自身画布内缩放/滚动，并提供同一数据的可键盘操作关系列表，不能通过把字体缩小到不可读来塞满屏幕。沿用现有色彩、字体、边框、圆角和动效变量，不引入另一套主题或修改ui/。主聊天、草稿、消息滚动和其他弹层不因浏览订阅更新而重建；外部点击可收起并继续响应本次外部操作，面板内拖选到外部不触发误关闭。Escape只关闭最上层视图并恢复相应入口焦点。

**工作区归属。** 有正在查看的会话时，以该会话实际workspaceId为准；无会话时用侧栏选中工作区。跨工作区置顶会话不能误用侧栏空间。面板打开即绑定宿主签发的viewId、当前连接和授权入口；同一indexKey也不能跨workspace/policy混用浏览结果。切换实际工作区立即取消旧读取、解除订阅、清除旧正文/游标，并为新归属建立视图；同工作区内切会话不重置树的展开和选择。无工作区时入口说明需要先打开工作区。普通关闭仅释放浏览绑定及监听，不关闭共享worker、不取消索引维护。

**树是关系的导航投影。** 默认展示功能；模块、知识、实现、符号是可切换的分类入口，不假造module→feature的contains层级。树按当前授权视图的contains展开子功能/子模块，功能uses展开行为，行为code展开符号或SourceRef；relates、applies_to、test等在关联区明确标注。根是当前可见组织关系的根，不能泄露被隐藏父节点。一个对象可从多个路径到达，实体始终使用同一objectId，界面行使用完整出现路径＋edgeId；不能复制实体以强行变成单父树，也不能用全局visited隐藏合法共享。逐路径回访才停止继续展开。不同slot引用同一实现时，各流程步骤按uses edgeId保留身份；标出共享引用，点击进入同一实现详情。

**功能与流程展开。** 点击功能展示其自身flows；点击子功能进入子功能自己的流程并更新面包屑。父功能包含某个子功能只表示组织关系，不能自动接出子流程调用/返回箭头。点击实现步骤展示触发、条件、动作、结果、边界、未知项及代码/测试来源；implementation不再包含implementation。点击条件标签可查看该条flow的条件和直接来源。只按已有beforeEdgeId/afterEdgeId连线；条件字符串原样作为有界文本展示，未知分支不补else，无依据的先后、互斥、穷尽、并行等待和调用返回均不推测。回边显示为回访连接而不无限展开；多前驱仅表示共同后继。暂无flows时显示“尚未组织流程”，成员仍可浏览。复杂流程按局部关系和已组织子功能逐层进入，首版不把任意源码转换为完整控制流图。

**详情、证据与可信状态。** current/stale/unresolved与coverage分别展示；current说明本次依据检查未发现漂移，不命名为“完全正确”。specified要求与observed事实分开展示，文档要求不能冒充运行流程。缺口、未加载页和来源受限分别说明；无权限的名称、ID、正文、路径、数量明细及悬空端点不进入客户端。箭头所需端点/uses/来源不再允许披露时，整条关系及受污染正文一起隐藏，不能删掉SourceRef后保留结论。源码在视图内按需预览，输入仅为服务签发sourceRefId；复验当前policy和内容hash，实际页范围使用零基半开UTF-16；源码页保留requestedSourceRefId并返回本页范围对应的SourceRef，不能改写原持久引用或用整段范围冒充本页文本。源码变化返回FILE_CHANGED并提示重新读取，不能拿旧行号指向新内容。浏览源码不签发或消费locator的已读证据ledger。

**只读端口与分页。** IndexBrowseService的list支持roots/children/search，getObject返回按kind判别且带快照内稳定key的fact/boundary/unknown/relation/flow/evidence片段及机械symbol来源，readSource返回有界源码页；共享IndexBrowseSnapshot绑定viewId、indexKey/workspaceId、观察/语义epoch、policy和analysisContext，详见contracts.ts。错误使用明确ErrorCode，不混在成功空数组中；NOT_READY/DISABLED与真正空结果分开。IndexService继续只给模型工具使用，管理操作仍走独立授权入口。每页默认最多50条列表项或60个步骤/120条flow关系，连同元数据不超过64KiB UTF-8；详情和源码按完整片段/合法文本边界分页，单个不可分片项超预算明确报错，不静默截断事实。flow片段携带本页两端已授权的uses实例与实现引用，不能画出未交付或不可披露的端点。排序和游标由服务确定，游标绑定操作、目标/查询、排序版本、浏览绑定、policy与完整快照；重试同页不漏项、不重复插入。旧快照失效明确返回SNAPSHOT_EXPIRED/RECORD_CHANGED，不拼接新旧图，不把首屏当完整功能。

**独立订阅与局部刷新。** 浏览器仅在打开时订阅宿主签发视图的IndexBrowseNotice；事件只有单调sequence及changed/policy_changed/unavailable，不广播对象正文或隐藏标识。通知合并读取，同view至多一个在途请求，期间新变化保留补读意图，不无限推迟刷新；最终响应同时核对连接、viewId、工作区、快照和请求generation。普通变化先标记旧视图待更新，再按当前授权重取可见部分，保留仍有效的展开、选择、滚动和搜索输入，不在用户拖选或操作菜单时重新排整棵树。撤权或来源策略变化立即清除旧正文与缓存/游标，丢弃迟到回包并重新鉴权；不能以保留焦点为由继续显示受污染内容。新旧视图不能混页；已被用户看到或复制的内容无法由此撤回。

独立交互样稿位于`artifacts/prototypes/index-browser/index.html`，打开即展示示例数据和可操作视图；关闭后可用页面中的文字按钮或右下角“Index · 示例”重新打开。它演示默认功能导航、条件流程、步骤/来源展开、索引批注与生成可复制的定位请求，以及加载/空/错/待核验状态；合成示例明确标识，不连接真实索引。该样稿帮助确认交互，不构成生产API、分页、权限、图布局或完整UI验收。实施使用现有React/transport/弹层基础，IndexBrowser、IndexTree、FeatureFlow、IndexInspector和SourcePreview按职责拆分；局部关系图布局是可替换的纯展示适配器，不掌握源码权限或正式写入权。

### 8.5 索引批注与带定位的修改请求

用户可在功能、实现步骤、分支条件或已经交付的源码上批注，将修改意见连同定位交给当前主Agent。索引浏览仍只读；保存、编辑、删除批注或生成请求均不调用模型、不写索引、不改源码。用户主动发送后，主Agent按既有工具权限读取当前依据、修改并验证；对象ID可作为locate_code查询线索，内部locator通过index_query.ids精确读取获准对象，旧ID失效不按同名静默恢复。修改产生的文件事件再进入第10节维护。内部locator仍只定位和提案，不取得代码编辑权；“纠正索引说明”也须走已有证据与提案提交规则，不能用批注直接覆盖正式知识。

**交互与归属。** 复用现有批注开关、编辑器、编号、查看全部及统一发送体验，默认关闭；增加“批注此功能／此步骤／此分支”和源码入口，触控及键盘无需拖选也能使用。直接点击详情按句、源码按行；拖选只引用选中的字符，跨详情片段或源码页提示缩小范围。允许选择“修改功能实现”“纠正索引说明”“提问”，默认修改实现。当前已有编辑器时第二个目标不能替换正在写的意见。树／图上的编号与批注列表对应，列表可编辑、删除及返回原位置；无flows的功能说明仍能批注。关闭模式／浏览面板保留内存中的批注及编辑意见，编辑意见不重新渲染来源。批注按当前查看实例、实际workspaceId及sessionId隔离；同工作区切会话可以保留浏览树状态，但不能混合批注或用异步完成时的新会话作为发送目标。无会话可浏览、记录工作区草稿和复制，发送前须绑定界面明确显示的真实目标会话；已有会话归属不能静默转移。首版不承诺刷新后恢复、不新增批注数据库、审批或解决状态。

**不可变定位。** 使用独立IndexAnnotationDraft，不伪造ReplyAnnotation.messageId。捕获IndexBrowseSnapshot、工作区／会话归属、引用原文及片段内UTF-16零基半开偏移。功能带对象id/contentRev/recordRev；步骤额外带所属feature、所选uses edge的双版本、slot和implementation双版本；分支带所属feature版本、快照内flow片段key、完整beforeEdgeId/afterEdgeId/condition/evidenceIds及两端步骤身份。key只在原快照内稳定，不能把数组序号或条件文字当永久身份。源码还带requestedSourceRefId、实际页SourceRef（路径、原始文件字节hash、页范围）及页内精确选区；不能把引用扩到未读页、只记文件名或用显示行号代替正式坐标。展示从哪条关系进入，定位以所选uses实例为准；同一implementation的不同slot及不同功能不得合并批注。共享行为明确提示修改同一源码可能影响其他流程，不承诺修改只影响当前卡片。片段引用、版本和hash在保存及编辑意见时保持不变，不能因刷新或文本相似而偷偷重绑。

**核验与失效。** 返回原位置、重新展示来源、复制及发送前，通过现有浏览适配器和AuthorizedReadView重验当前入口授权、归属、对象／关系版本和源码hash；旧viewId只记录捕获来源，关闭后须建立新的读取绑定，不能当授权凭据复用。相同内容重新核验成功才允许精确高亮；来源变化、退休、缺失、快照过期或多个候选时保留原引用并明确标为旧／未确认，只打开已获准的上下文，不拿旧坐标高亮新正文、不自动选同名对象。允许把仍可披露的旧引用作为“先重新定位再修改”的请求；它不证明当前事实。必要来源闭包已不可验证或权限撤销时隐藏受保护原文、路径、ID及依赖说明，阻止该批携带这些内容复制／发送，保留用户手写意见并显示原因，不静默丢掉条目后发送剩余批次。批注列表／编辑器可见时为其来源保留有界失效监听，即使浏览面板已关闭；隐藏时清展示缓存，再次显示先核验。撤权丢弃迟到响应；普通变化不改写引用。监听不持有worker关闭权，切归属、归档、断连和关闭按独立订阅规则释放。不得把拖选／浏览视为locator已读证据或模型已理解。

**发送与恢复。** 批注生成普通Draft文本，逐条包含处理方式、用户意见、不可变引用、定位JSON和当前核验状态；明确引用只是数据，不是新指令或读取授权。宿主授权边界仍决定可读／可写范围，不能信任客户端提供的workspace、路径、版本或自报current。与回复批注共用现有Composer/useSubmission路径：捕获原会话和本批内容，以独立`{text, attachment:null}`发送，不覆盖普通草稿、不夹带其附件；空闲使用普通prompt，运行中按现有协议进入Steering，服务端解决活动状态竞态。不得另造发送队列、隐式开始第二个run或把索引只读端口扩大成写接口。移出待发列表仅代表提交开始，accepted不表示消费、执行或代码修改成功；只清理本次捕获的条目，不删发送期间的新批注。明确失败将含定位的完整请求合并回发起会话输入框，遵守既有去重恢复；未知结果按原requestId查询回执，不自动重发；撤回按既有输入回执恢复。失败恢复为普通草稿文本，不承诺恢复成批注卡片；旧定位继续要求核验。此类用户主动发送文本进入普通会话历史，适用第9.3节自由文本溯源擦除边界，不能声称后续撤权能收回已发送引用。

**边界与实施。** 单条原文6,000、意见2,000、整批序列化文本连同定位元数据12,000个JavaScript字符串单位，与现有消息长度口径一致；超限保留全文、明确提示并禁止发送／复制，不自动截断、丢定位或拆批。样稿仅实现合成数据上的添加／编辑／删除／定位、选区高亮、草稿保留及请求复制；复制失败选中全文以供手动复制，成功只提示“已复制，尚未发送”。样稿的待核验状态不等于真实版本或撤权验证。阶段0冻结定位DTO、真实会话绑定、发送前核验和失败恢复；阶段5在已有批注状态／展示边界引入回复与索引目标的判别类型，并复用输入链路，不能要求已有回复批注使用索引字段。只复用已有交互、存储和发送职责，不预建通用批注框架。产品验收按UI09–UI14执行。

## 9. 上下文交付与压缩恢复

### 9.1 宿主交付，不考模型背诵

数据库版本、正文 hash、范围和是否实际放入请求可由程序验证；模型是否理解正确通过真实任务验收。首版不复制 AOCI ordinal/Tag 回忆挑战、掌握度分数或日常全索引重传协议。

必须区分：`prepared`（生成了包）→ `included`（正文进入本次实际模型请求）→ `obsolete`（当前上下文或依据变化）。included 不表示模型已理解，更不证明过去的正文仍在压缩后的上下文。

### 9.2 唯一注入路径

使用 pi 1.1.0 `context` 请求级 hook，在最终发起模型请求前加入一条普通参考资料消息；不提升到 system 权限，不用 `appendEntry` 的 custom 元数据假装正文可见，也不再同时追加同内容 custom_message。固定组合顺序：先完成现有 resumeSession 的失败尾部清理/中断工具结果配对及 omitResumeControls/refreshContext，再从清理后的会话投影取得 generation；构建请求局部消息并按第 9.3 节过滤旧索引工具结果，按现有标题状态添加标题指令，最后加入索引参考消息并统一返回。所有标题分支都必须经过索引注入，不能因提前 return 跳过它。保留原消息次序、system 状态和工具调用/结果配对；带临时标题/索引正文的数组不得写回 SessionManager、用于持久 context_edit 或另存 JSONL。

host bridge 按第9.4节选择当前会话的相关知识，提供已渲染的有界包；hook只能短时读取/核对，不在hook内请求模型判断相关性、建库或等待维护任务。按“当前有效仓库概览 + 本会话当前任务对象及适用约束”组合，参考消息明确列出适用范围、依据版本、freshness和缺口。每次请求重建该消息，逻辑上替换前一请求的注入，不向历史重复堆积；用户主动调用repo_overview的工具结果仍按普通工具结果保存。

generation 至少绑定 worker 实例、会话、active branch/compaction 身份。压缩成功、恢复/分支更换或 worker 重启后生成新的交付身份。`session_before_compact` 只能通知准备压缩，不能作为已完成依据；必须观察提交后的 SessionManager 投影/现有 compression-applied 成功。pi的leaf是当前追加位置，普通消息、用量或custom元数据追加也会推进它；同一worker须核对旧leaf仍为当前leaf的祖先或等于当前leaf，并结合导航与已提交压缩事实判断连续性，不能仅因leaf变化就认定切换了分支。context_edit是普通追加也仍须独立废弃受影响准备包；worker重启直接生成新身份，不以证明重启前后的导航历史为前提。

包的hash、object revisions、scope、generation及第9.4节的焦点元数据写deliveries.manifest_json，不另存聊天正文。每次请求有独立deliveryId，并在included时绑定实际modelRequestId，不用同一run的旧included替代后续物理请求。实际送往模型的消息在SDK适配测试中捕获验证，DB收据不能代替该验证。新worker即使看到旧included，也必须重新选择、核验并准备正文。

### 9.3 预算与故障

自动注入默认最多 3,000 估算 tokens 且不超过模型可用输入预算的 10%；任务关键约束优先于背景描述。超限给出缺口与 repo_overview 展开入口，不截掉关键约束后声称完整。预算和当前上下文估算必须包含这条请求级消息；仅估算持久SessionManager投影会漏掉它，阶段0须验证最终请求和页面/自动压缩阈值的口径一致。

维护积压时注入当前可靠子集及 stale/gaps；DB 失败只注入简短降级说明。索引不可用不阻止用户停止、压缩或主会话继续读源码。仅涉及权限/归属错误的读取严格拒绝。压缩摘要可保留任务指针和待办，但不把其中拷贝的旧知识当作当前证据。

授权/policy 收紧时立即废弃受影响的 prepared 包、cursor 和缓存，实际请求发送前再次核对当前授权、policyHash 及必要来源闭包。混合允许/被排除依据的对象整体省略，包括 summary、knowledge、关系说明和派生 flows；不能只删路径/SourceRef，或因该会话过去访问过就继续注入。后续只有基于仍允许来源独立复核并提交的内容才可重新交付。

索引工具结果在 `details.axiomIndexContext` 持久化 indexKey/workspaceId/policyHash（目标 IndexToolDetails 见 contracts.ts）。请求局部投影也检查历史 locate_code/repo_overview 结果；归属/策略不再匹配或缺失可信元数据时，整体替换为简短的“索引资料已因权限或策略变化省略”，保留 toolCallId/toolName 与协议配对，不改写原始历史或用量回执。最后准入时发现策略再次变化则重建或省略索引正文，不能沿用已准备的旧包。

这项保护覆盖索引服务交付及可识别的索引工具结果。已发送的历史请求无法撤回，任意用户/助手自由文本或既有压缩摘要也不能据此声称已完成溯源擦除；需要排除这些历史内容时须由会话上下文管理另行清理或使用不携带旧历史的会话。验收必须区分本次索引交付过滤与历史内容清理。

### 9.4 当前任务的相关性选择

组件责任按第2.7节分开：SessionFocusAdapter处理pi历史事实，ContextSelection处理归一化线索与授权索引对象，DeliveryBridge处理逐请求交付；三者不能各自实现另一套分支判断、freshness或披露规则。

相关性是有来源的检索选择，不是对用户意图的确定判断。首版由宿主使用现有词项/路径/符号检索和已核验关系做确定性选择，不增加一轮“判断相关性”的模型请求；主Agent可通过新的locate_code查询纠正或扩大范围。相关性不能替代授权、来源闭包或freshness检查。

1. **绑定当前分支和用户锚点。** 先从完整当前getBranch()确认最近已实际消费的用户输入，记录latestConsumedInputEntryId作为任务界限，包括宿主确认的axiom-append；排队未消费输入、标题/恢复控制、子任务通知和压缩摘要不算新用户任务。普通选择只从清理后的projection.entries[].messages取得该输入的有效文本，不从sourceEntry.message读取未编辑的旧正文。较新输入被context_edit省略后仍阻断更早任务，不能回退到投影中较早的可见用户输入；没有有效锚点时退回基础概览，不用留存工具结果重建旧任务。若仅因压缩而不可见，只能按第5项恢复同一最新输入的元数据线索。每次新的用户输入重新建立锚点，不按sessionId累计历史访问；锚点ID不变但有效正文被编辑，也必须重选并废弃旧准备包。即使“继续”等输入信号不足，也只给有界基础概览，等待主Agent明确查询，不猜测它必然承接旧任务。
2. **收集本锚点内的可信线索。** 使用当前有效用户文本中的检索词、明确路径/符号，以及该锚点之后发起且已完成的最近8次相关工具调用：locate_code的query/hints及当前仍允许的返回对象、repo_overview的显式scope、受信适配器确认成功的文件读写路径。最近8次按当前分支中完成结果entry的顺序倒序选取，不按调用开始时间、墙钟或通知到达顺序；调用与结果均须有效且可信。显式路径须先按工作区规范化并经过当前FilePolicy；路径只是检索线索。工具调用与结果须能按原始toolCallId在当前分支唯一配对，分别绑定承载调用参数的assistant entry和结果entry的身份与摘要；工具名称相同不证明适配器可信。任一侧被当前分支中的context_edit针对时，均不再用该调用建立焦点，也不从替换消息仍保留的details提取旧对象。失败/取消、isError结果、带axiomInterrupted的合成占位及结果未知的调用均不算成功文件访问；实际可能产生的写入仍由变化对账处理。迟到的旧任务回包、其他会话访问、自由文本声称“读过某文件”、不可验证的shell/扩展输出不能种下焦点。文件访问只能提示相关，不证明行为正确或扩大读取授权。
3. **检索与有界扩展。** 最多32个种子、128个候选，先取明确对象/精确路径符号，再取当前用户词项命中；用已核验的code/uses/relates/contains邻接关系补一跳候选，并补这些对象显式applies_to的知识及相关contradicts双方。模块scope与路径匹配可作导航线索，不能据此生成职责或行为。候选上限不缩减授权和必要证明依赖的闭包校验；校验不完整则省略或降级，不能强行current。
4. **按预算交付。** 先保留当前适用约束与冲突，再放明确命中的任务对象、词项候选和模块背景；同优先级按稳定ID排序。基础概览保留版本化的模块导航与覆盖缺口；全仓约束必须有已核验的适用范围，不能因名称“重要”而强行全局化。每个入选对象记录固定原因码和信号entryId，不存用户文本、完整工具输出或模型推理。无匹配时回退基础概览，数量/正文超限明确列gap，不宣称已掌握全部相关知识。
5. **压缩与恢复重选。** ContextFocusSnapshot只保存最新已消费输入界限、可用用户锚点、当时branch leaf、各信号的原生身份/摘要和入选ID/原因，随ContextDelivery记录indexKey/workspace/session/policy/selectorVersion。压缩后同一任务可把旧ID作为候选线索，但必须核实同一归属、旧锚点仍是完整当前分支最近已消费输入；其后出现过较新已消费输入，即使后来被省略，也阻断旧快照连续性。完整getBranch()用于验证锚点、调用、结果和针对它们的全部context_edit，包括已被压缩移出当前投影的编辑记录；投影中找不到edit不代表未编辑。保守地放弃存在任何此类删改记录的旧信号，并重验其余信号的身份、摘要、原始toolCallId配对及当前授权、版本与来源。原始分支只作恢复核验，不用于重新提取压缩前正文的检索词；旧ID仍只是候选，不能恢复旧正文。分支切换或新worker按当前路径重建，不把全量getEntries或其他会话的最近访问当任务历史；主动切回不含较新输入的旧分支时可按该分支重新选择，但不得复用原prepared包。元数据缺失、被清理或无法证明连续性时放弃旧焦点；旧summary和旧included均不证明当前知识有效。

ContextEntryStamp分别保存entryId、sourceHash和projectedHash：sourceHash绑定原始entry的规范JSON持久化表示，projectedHash绑定该entry在准备时的有效投影messages；省略未定义的可选对象字段后，均按第4节的JCS规范计算SHA-256，无法规范化时舍弃信号，摘要算法与pi投影版本纳入selectorVersion。已被压缩移出投影的信号，仅在确认完整当前分支从未编辑该entry后，才可按锁定pi规则由原始entry重算未编辑消息摘要作等值校验；不能借此重新提取正文线索。用户信号绑定锚点；工具信号的顶层stamp绑定结果，call字段另绑定承载调用的entry，不能只保存结果身份或只比较sourceEntry摘要。非空userAnchorEntryId必须对应一个user_input信号，并等于latestConsumedInputEntryId；signalEntryIds引用这些信号的顶层entryId。存在编辑时，只有当前有效投影可提供新的用户文本，原始hash相同不能证明有效正文相同。有效投影负责选择当前可见信号，完整当前分支负责验证历史身份与编辑，两者不能互相替代。

这些entryId均指pi原生SessionEntry.id，toolCallId指原始工具调用ID，不混用界面消息ID、run限定的工具展示key或输入回执ID。焦点恢复可读取必要原始entry核对hash，但只持久化上述元数据，不把压缩前聊天正文重新注入模型。当前保留投影中的新线索优先于恢复线索，合并后仍最多8次相关工具调用，再按32种子/128候选限制选择。请求的最新消费输入、锚点及其有效内容、调用/结果依据、分支/压缩身份、context_edit、policy或选择器版本变化时废弃受影响准备包，按新快照重新准备或退回有界概览。选择结果与实际进入本次请求的正文一起接受K06–K10、K17和K31验收。

## 10. 主动维护与持久待办

### 10.1 触发与失效

Maintenance只组织变化意图、稳定点和任务调度；SourceEvidence负责机械对账，AuthorizedReadView负责当前可用性，语义修订进入统一Runner/CommitCoordinator。维护模块不能再实现一套解析、模型工具或提交逻辑。

工具完成事件只记录可能涉及路径；宿主确认的只读工具不产生写变化，shell/自定义工具没有可靠副作用清单时标记相应scope需对账。失败或取消的写操作也可能已产生变化，不能仅因执行未成功而跳过。watcher同样只提供提示；事件先落change_events并按第6.2节停止把未核对依据当current，不等待模型维护。

| 触发入口 | 何时请求模型核验关系 |
|---|---|
| 前台locate_code | 已有结果不足、过时或有歧义时，按本次问题局部核验；可靠复用可零模型 |
| 代码/文档/配置变化 | 程序先对账、失效并记待办；达到下述稳定点，且自动维护、模型配置、授权和预算允许后，由宿主队列启动 |
| 显式bootstrap或jobs/retry | 用户明确启动有界初始化或待办重试，遵守对应范围与累计预算 |
| 导入复核 | 候选进入获准复核批次后，重新读当前证据；导入动作本身不把候选变为current |
| repo_overview、自动注入、sync或status | 只读/机械检查，不因查看状态或准备上下文启动新的模型维护 |

这些需要语义核验的路径均由宿主调用同一受限pi runner，模型提出节点/关系的新增、复核、修改或退休；程序决定提案是否可提交。监听一次文件事件不会立即启动一次pi，后台也不通过主会话伪造工具调用。

服务启动时，为已启用索引、未归档且仍授权的工作区安排有界机械对账；重新打开 worker 时也必须对账。恢复不能只续已有 jobs，还要从持久清单与当前摘要差异补齐“主 run 已终结、变化/维护意图尚未落盘”的窗口。无法确定来源 run 时以 reconcile 事件记录，不编造归属。

`agent_settled`/宿主 onSettled 是稳定点候选，不是源码稳定证明。只有同 indexKey 的全部入口没有已知活跃写入执行、变化 debounce 窗口结束且复核内容摘要一致时，才提交维护候选。外部编辑、兄弟会话继续修改时推迟受影响 scope，其他 scope 可独立处理。提交仍必须重核依据和 CAS。

结算订阅只记录/合并意图并唤醒队列，不等待 locator 或模型维护。各订阅独立捕获同步异常和 Promise 拒绝；索引失败不能改变已保存的主 run 终态，也不能阻断 Tasks 的结果通知、交付或压缩协调。意图持久化失败时报告诊断，并由上述对账恢复待办。

readonly run 没有变化时不产生语义维护。失败、取消、interrupted run 也要对账，因为可能已经修改文件；停止该会话不能阻止其他会话未来读取这些实际变化。

### 10.2 队列

后台维护按 indexKey+scope+输入摘要合并，保留 originRunIds；摘要包含有效 policy/分析上下文，不同权限依据不得合并。初始化/导入复核还把 purpose/groupId 纳入 coalesce_key，不能混用独立命令的总预算。状态为 pending/running/done/blocked/cancelled/interrupted，记录原因、尝试数、下一次可运行时间、checkpoint 和 lease。每批冻结已接收事件的高水位，仅消费该范围内且实际覆盖的事件；处理中再来变化留给下一批。同coalesce_key已有running时记录新事件，不新增第二个作者；完成后重新比较摘要生成后继任务。

待办属于 indexKey；ownerWorkspaceId 只记录本次执行采用的授权入口，尚未准入时可为空。领取作业时选定仍授权、未归档的入口，冻结其有效策略并签发新的 admissionId/lease。该入口撤销后停止本次执行，不能在途换身份；若其他入口仍合法，可按既有 checkpoint、原预算和最新依据重新排队，无合法入口则封存。更换入口不清除累计费用、小时限额或未消费事件。

后台提交还要核验宿主持有的 job/lease 身份，过期执行不能关闭新执行的待办。语义变更、submission、该批已覆盖事件的消费标记和 job checkpoint/完成状态在同一事务提交；尚未覆盖的变化保留，不能在写库后另起一个无保护的“清空待办”步骤。真实模型用量独立持久化，语义事务回滚不能撤销已发生的消耗。

调度顺序：前台定位 > 用户显式初始化 > 后台维护。每 indexKey 最多一个语义作者；只读查询和解析可并发，提交串行。默认全局最多两个 locator、后台最多一个；前台有待处理请求时不再启动新后台批次。

取消父 run 后，该 run 拥有的 locator 立即停止；变化待办保留。后台维护须等待当前任务结束后按工作区开关/预算另起，不能以维护为由继续原用户执行或发消息。单独停止某会话不能关闭共享工作区的其他请求。

### 10.3 局部修复与错误预算

从变化依据的反向依赖开始，核验受影响事实/关系，必要时只向相关入口/注册范围扩展。未变行为只刷新 review；关系失效只退休相应边；新行为先找现有实现再新增。

默认一次后台批次最多 120 秒、3 次模型请求、48k 输入/8k 输出 tokens；每 indexKey 每小时最多 10 批，同根别名不能取得额外额度。达到 token/费用/时间上限即 blocked 并写原因；认证缺失或定价未知时不假装成本为零，后台模型调用需有明确允许的 token 预算。自动初始化默认关闭，自动维护在工作区启用 assist/native 时开启且受上述限额；未配置后台模型时只记待办，不借用最后活跃聊天的模型。

短暂错误最多 3 次调度尝试，采用有界退避；鉴权、权限、持续版本冲突等进入 blocked，等待新证据、配置修复或显式重试。不让单个失败任务永久占满队列。

## 11. 初始化与整体覆盖

首次启用先完成机械清单，所有语义 coverage 为 partial。程序按包/入口/配置/目录生成候选 scope 卡片；模型根据真实证据确认模块边界与职责，不把候选直接写成完整架构。

初始化分三步，每步可中断恢复：

1. 为每个范围核实代表入口、主要行为、关键配置及明确缺口，生成可复用 implementation；按证据复用跨范围共享实现。
2. 组织 feature/module 引用，核验重要跨范围边，建立文档要求和实现观察的分离记录。
3. 对照允许文件/入口/scope 清单核查遗漏与冲突，生成 overview 投影和 coverage；未处理范围保留为待办。

每批的 inputDigest 包含 scope 定义、内容摘要、配置/策略及提示词版本，checkpoint 只在成功提交后前进。重启时已完成且输入相同的批次跳过；变更批次重排；未完成模型请求不重放。

初始化命令冻结独立模型选择及整项预算，默认最多 15 分钟、10 批、30 次物理模型请求、累计 240k 输入/40k 输出 tokens，任一上限先到即暂停并保留剩余 scope。恢复延续已消耗预算；只有明确增加额度才获得新预算，不能靠重启/分批绕过总限额。每批同时遵守 jobBudget；导入候选复核使用同样的总预算机制。

初始化“完成”表示计划中的范围都有明确处理结果、版本有效、错误可见，并非每行代码都已理解。只有自己实际核实的范围可标 reviewed_scope；不要求先建完整全仓知识才能完成一次定位。

## 12. pi 适配、权限、记账和预算

### 12.1 LocatorRunner

锁定 pi 1.1.0，使用 `createAgentSession`、`SessionManager.inMemory`、`SettingsManager.inMemory` 和宿主自有 ResourceLoader。locator 的内存设置显式包含 `cacheWarming: "off"`、`compaction: { enabled: false }`，不继承用户/项目设置；创建后断言实际生效。上下文不足时返回 partial/error，不自动发起摘要或预热请求。不发现全局/项目扩展、技能、MCP、packages 或任意 context files；仅把经过授权的资料作为证据输入。

内置工具集合为空，自定义工具严格为 index_query/code_evidence/index_submit，实际注册后断言可用集合。worker 不得到通用 shell、文件写入、delegate 或工具加载接口；内部工具再次校验路径和请求归属。权限由执行层保证，不只依赖提示词。

专用 worker 通过宿主获得当前 Selection、冻结的 modelsFile、认证运行时及预算。前台 locate 冻结父 run 的有效模型选择；初始化使用命令显式选择；后台维护使用工作区配置的 backgroundSelection。各选择均复用 `app/src/shared/agent.ts` 的 Selection/Thinking，不接受任意 thinking 字符串，不在请求中途跟随页面切换。模型被移除、权限撤销或凭据失效时 blocked/error，不偷偷换模型。提示词编译进产品 TS 模块，不能依赖 npm 发布清单未包含的包内 Markdown 路径。

等待 `prompt()` 最终完成/最终 settlement，不能在底层 `agent_end` 时提前提交。结束或取消后 abort/dispose/unsubscribe，清理 IPC pending；worker 超时后按现有进程管理约定终止。

### 12.2 调度、重试、归属

新增索引专用有界调度；不能持 `ModelService.serial()` 配置锁等待模型，不持主 Agent 独占请求槽等待 locator。locator 设置 `retry.provider.maxRetries=0` 关闭 SDK provider 层隐藏重试；临时故障由 pi 会话层有界重试处理，每次实际请求与重试都先取得剩余次数/token/deadline 准入，再单独记账。索引层只管理总 deadline 和明确的一次格式/版本修复，不再套供应商重试。实际发送层必须验收请求数，不能以 worker 数或 prompt 次数代替。

索引 IPC 绑定 workspaceId/sessionId/runId/requestId/attemptId/callId、宿主签发的 admissionId 和进程实例；模型不能提供或覆盖 admissionId。每次异步准入后及最终提交前重查调用方、工作区授权/归档状态和后台 job/lease；过期身份与新 worker 不能沿用旧准入。

最终提交准入与停止/撤权/归档的撤销由 IndexManager 按同一顺序串行：先获准的短事务允许确定收尾，撤销后不再授予该所有者的新提交。撤销成功回执在已授予事务完成或确定中断后发出，不持数据库事务等待 IPC 或模型。取消在 worker→host→locator 的整个链路传播；迟到结果可保留已提交事实，但不能投递给新 run、其他尝试或别的会话。

### 12.3 用量

每个物理模型请求（含重试）在发出前持久化唯一 usage event，绑定 modelRequestId、requestId/attemptId、归属及 provider/model，并预留预算。measurementState 为 pending/reported/unknown，与 workspace/session_pending/session_recorded 的投递状态分开；无法确认请求是否发出或消费多少时保留 unknown 和预留额度，不能重放请求求账单。只有实际取得的计量才能标 reported，SDK 默认零值不算供应商回执。已知 tokens 与未知价格可并存，cost=null；reasoning 是 output 子集，不能重复相加。

前台工具结果在 `details.axiomIndexUsage` 保存 `IndexUsageEnvelope`（见 contracts.ts）：version、usageEventIds 及逐事件的身份、revision、measurementState/usage 和会话归属；ID 集合必须与 events 一致。pi 原生 `usage` 只汇总能准确表达的已知消耗。每次计量更新增加事件 revision，同 ID/同 revision 的正文不一致则拒收。初始化/独立后台维护记在 indexKey 下并保留采用的授权入口，不加入任意聊天账单。

补账只补事件回执，不重建工具成功结果。补账异步排队，不阻塞当前工具回包或主 run 结算；活跃会话由宿主经所属 worker 的安全边界请求幂等补记，暂时无法落盘则保留 pending。空闲会话先释放并等待保活 owner，再取得与启动、恢复和压缩共用的会话写入锁。锁内再次检查是否已有新 owner 接管；若已接管则转交所属 worker 或保留 pending。确认空闲后重新打开最新 transcript，按事件ID/revision核对回执再补记，不能沿用释放前的 SessionManager 或统计快照。锁覆盖核对与追加，并与新 owner 注册互斥；宿主不能与 worker 同时追加 transcript。补记使用 `appendCustomEntry("axiom-index-usage", envelope)` 元数据，不发送用户/模型消息，也不再追加一份原生 usage。正常工具 details 与补记条目共同构成持久回执；确认对应 revision 实际落盘后才 CAS 标记 session_recorded。回包丢失时先扫描回执；无法安全写入则保留 session_pending。

新增统一的 `projectSessionUsage` 纯投影，读取与 SDK getSessionStats 相同的全量 session entries（含已压缩历史）。保留普通 assistant/tool、usage、压缩及分支摘要的原生统计；排除带有效 axiomIndexUsage 标记的索引工具原生 usage，再按 usageEventId 的最高有效 revision 汇入一次已知计量。这样正常结果与补记可以重复到达而不重复计费。投影校验所属 session，其他会话的回执不能入账；pending/unknown 及未知价格计数单独返回，已知数值只是小计，费用不全时总 cost=null。

主 worker 的周期/final usage、冷恢复以及空闲压缩后的统计均使用同一投影，再附加当前 contextUsage。AgentInfo.usage 增加 indexAccounting 完整性字段并据此展示小计/未知；宿主只接收当前 owner 的完整统计快照，不能在缓存总额上单独加账后再被下一次 worker usage 覆盖。上下文估算和账单累计仍各自保持原口径。

发布前用假模型和真实 SDK 检查成功、重试、工具错误、取消、断连、提交后回包丢失、补账后继续执行/压缩及计量返回前进程死亡各路径。已知事件恰好一次归属；缺失计量只报告未知，不能承诺恢复精确 token 或实际账单。账务恢复本身不启动模型或提交新的仓库语义。

## 13. 管理命令与可观测性

新增服务命令命名空间 `index.*`，通过当前已鉴权命令通道执行，至少包括 status、doctor、sync、bootstrap、jobs/retry、overview、export/import、rebuild、mode、configure。CLI 增加对应命令和参数校验，只调用运行中的宿主服务，不在另一个进程直接写活跃 DB。若服务未运行，先按现有服务管理启动；不绕过工作区归属检查。

mode、automaticMaintenance、backgroundSelection 和预算以 indexKey 为粒度保存在私有数据库 meta 的版本化配置中，同一真实工作区共享。`index.configure` 只允许修改这些有界配置，模型配置引用供应商/模型 ID，不复制凭据。每个 job 保存启动时的配置摘要和累计消耗；降低预算或撤销授权立即作用于正在执行的任务，提高预算不自动重放失败任务。

- status：范围、符号/语义覆盖、stale/unresolved、队列、最近有效提交、预算和禁用原因。
- doctor：数据库完整性、引用/类型/环、来源和 policy、丢失 scope、过期 lease、重复候选、未入账 usage；默认只读，修复需单独明确命令。
- sync：机械对账与失效，不调用模型；bootstrap/retry 明确展示预算及可中断性。
- export/import/rebuild：遵守第 4 节资产边界；不把敏感运行资产打入产品包。

日志只记录 request/job/object IDs、版本、状态、耗时、token、错误与必要脱敏路径；不默认输出完整源码、凭据、完整提示词或聊天正文。前台定位沿用第8.3节的工具过程反馈；后台维护通过已鉴权的index.status/index.jobs返回范围、pending/running/blocked等真实状态、最近阶段、耗时与可得用量，不写入任意聊天或创建delegate卡片。上述index.*命令是待接入接口，现有命令通道可复用；首版不为后台维护新增管理页面。第8.4节的Index浏览器独立展示已提交知识与来源，只读浏览不授予bootstrap、backup、import或reset等管理能力。

## 14. 确定性与集成验收

### 14.1 三层验证与夹具

单元测试验证解析、证据、失效、事务和渲染；真实 SDK + 可控 provider 验证实际工具集、模型请求上下文、重试和记账；真实任务评测验证模型语义与效益。三者不能互相替代。

统一夹具包含：入口改线/注册覆盖/自动发现、共享实现、多阶段 slot、同名与重载、中文/emoji/CRLF、文档要求与实现冲突、配置继承、语法错误、不支持语言、链接越界、跨 worktree、动态调用和无相关测试。

以下保留 64 个基础用例 ID；后续实现不得删减或以“JSON 合法”代替语义要求。

### 14.2 文件与符号：F01–F12

| ID | 场景 | 必须满足 |
|---|---|---|
| F01 | 首次扫描允许文件 | 清单正确，忽略原因可见，不读凭据 |
| F02 | 相同源码重复初始化 | 无重复符号、无无意义版本增加 |
| F03 | 不同文件/类同名声明 | 定位与引用不混淆 |
| F04 | 重载、匿名回调、内嵌函数 | 身份明确或返回歧义，不伪造 |
| F05 | 中文、emoji、CRLF与跨页边界 | UTF-16范围精确回读原文；页边界不拆码点/代理对/CRLF |
| F06 | 内容不变仅 mtime 变化 | 不判为语义变化 |
| F07 | 同长度且恢复旧 mtime 的改动 | hash 检出，旧 SourceRef 拒绝 |
| F08 | 文件新增/删除/重命名 | manifest/scope/symbol 正确失效 |
| F09 | 语法错误/写入中 | 当前文本可读，旧 AST 不标 current |
| F10 | aliases/extends/解析器版本变化 | 分析上下文失效并可重建 |
| F11 | 不支持语言/大文件/非 UTF-8 | 降级/跳过原因可见 |
| F12 | worktree、链接、路径大小写 | 隔离正确，不能跨授权根读取 |

### 14.3 三层语义：S01–S12

| ID | 场景 | 必须满足 |
|---|---|---|
| S01 | 一个行为跨三函数 | 一个 implementation 可多 code 关联 |
| S02 | 一个函数有两个独立行为 | 允许两个实现，不按主符号强制合并 |
| S03 | 两功能共享实现 | 同一实现、独立 uses 证据 |
| S04 | 同功能分阶段用同实现 | slot 区分，flows 引用正确关系实例 |
| S05 | 嵌套/共享子功能 | 引用展开，不复制子树 |
| S06 | contains 引入环 | 原子拒绝，DB 不变 |
| S07 | implementation 嵌套 | 类型校验拒绝 |
| S08 | 只有名字/README 无源码 | 不写已证实运行关系 |
| S09 | summary 多出事实外保证 | 标注夹具/独立语义评审判失败；程序引用校验不能证明蕴含关系 |
| S10 | 局部核验未涉及旧分支 | 不删除旧分支、不刷新整个父 review |
| S11 | 退休一条 uses | 不删其他功能共享实现 |
| S12 | 同请求/等义维护 100 次 | 对象数量/contentRev 稳定；仅真实状态变化推进 recordRev |

### 14.4 变化与缓存：C01–C12

| ID | 场景 | 必须满足 |
|---|---|---|
| C01 | 精确问法重复且依据未变 | 可零模型，仍核验依据 |
| C02 | 同义改写 | 复用候选，不盲用答案 |
| C03 | 否定、默认值、数字变化 | 不误命中缓存 |
| C04 | 旧函数没改但入口换了 | 旧 uses 失效并指向新入口 |
| C05 | 注册文件新增覆盖实现 | 内容指纹变化，不能只比较文件名 |
| C06 | 自动发现目录新增文件 | scope 成员变化并补查 |
| C07 | 无关模块改动 | 答案缓存保守失效，语义不全仓重写 |
| C08 | 源码变化、implementation stale但contentRev不变 | 必要依赖链上的feature/module/knowledge不得继续current，旧review不冒充新依据 |
| C09 | 复核确认语义未变 | contentRev不增；上层须其余依据仍有效才恢复current，不整体刷新祖先review |
| C10 | watcher 丢事件/服务重启 | 严格对账发现变化 |
| C11 | scope/ignore/授权变化 | 旧缓存不得泄漏已排除内容 |
| C12 | partial/not_found/写失败 | 不缓存为成功 |

### 14.5 提案与事务：W01–W10

| ID | 场景 | 必须满足 |
|---|---|---|
| W01 | 未签发或未实际可见的证据 | 拒绝引用 |
| W02 | 提交时源码已变化 | FILE_CHANGED，最多一次重核 |
| W03 | 非法JSON/未知字段/超限/重复或冲突操作ID | 整批拒绝，含临时ID映射后冲突；最多一次格式修复 |
| W04 | 同时更新同节点 | CAS 冲突不覆盖 |
| W05 | 同批新建/恢复端点、独立追加与并发成环 | 合法最终图可提交；组合后成环在事务内拒绝，投影一致 |
| W06 | 写节点后关系写故障 | 全事务回滚 |
| W07 | 取消/磁盘满/锁超时 | 不伪报维护成功 |
| W08 | 省略关系或空列表 | 不隐式删除成员 |
| W09 | 正文同而 review 不同 | 更新依据和 recordRev，不增加 contentRev |
| W10 | 提交前后源码漂移 | 不把旧结论包装成新版本 current |

### 14.6 pi/Axiom：P01–P10

| ID | 场景 | 必须满足 |
|---|---|---|
| P01 | 创建locator/上下文不足及能力注入 | 实际工具严格为三个；无预热或自动摘要请求；窄工具对象无管理/关闭/通用提交入口，核心规则与Query不依赖SDK/Runner |
| P02 | 项目/全局可扩权配置 | 不自动加载，执行层仍拒绝越权 |
| P03 | 源码/文档/别名恶意指令 | 当作数据，不能提升权限 |
| P04 | agent_end重试、已接受草稿被改/替换、digest不符或丢失 | 等最终结算才释放，仅completed且外层校验通过才提交；只用Worker冻结草稿，相同有效attempt/digest复用回执，其他正文不覆盖；缺失不补造，已有submission先核对；进度不把accepted或未知标为成功 |
| P05 | 取消与异步准入/提交竞态、旧进程实例消息 | 完整归属及worker incarnation核验；撤销后无新准入，旧attempt/实例不复活；已准入事务确定收尾，其他请求继续 |
| P06 | 100次创建/释放、并行调用及进度乱序/迟到/监听抛错 | listener/worker/handle无持续泄漏；真实阶段可见，零模型可跳过；工具行/过程组共用摘要且保留调用顺序；最终结果替换临时进度，展开/最终消息覆盖/重开一致，缺失元数据不补造事实；不回退、不跨调用，观察异常不阻塞执行 |
| P07 | 供应商限流、父等待 locator | 有界排队，无同槽死锁；实际请求/重试不超总预算 |
| P08 | 成功/取消/重试及补账后上报、保活复用、冷恢复 | 单写者；事件只计一次且不丢失，统一投影不被覆盖，未知计量不填零 |
| P09 | 切换 worktree | 无索引、缓存和来源串用 |
| P10 | 索引不可用 | 原只读查源码可继续，失败指标保留 |

### 14.7 检索输出：Q01–Q08

| ID | 场景 | 必须满足 |
|---|---|---|
| Q01 | 中文二字/四字/混合/camelCase | 正确命中候选或明确缺口 |
| Q02 | 错误路径 hint | 可扩大搜索，不错误硬过滤 |
| Q03 | 搜索截断、超过64KiB的单行及批量分页 | 预算充足且依据稳定时read/fetch_ref可读完；页范围/ledger准确，总字节限额有效；错误无假cursor，漂移拒绝续页 |
| Q04 | 多候选歧义 | partial，保留候选依据 |
| Q05 | 未找到测试 | 不猜测试路径 |
| Q06 | 名称命中但行为不符 | 检查具体 query 覆盖 |
| Q07 | 返回记录已退休/冲突 | 不渲染 current 成功 |
| Q08 | 核心/入口/条件结果 | AI 阅读包与提交记录/SourceRef 一致 |

### 14.8 原生认知、维护与退出：K01–K32

| ID | 场景 | 必须满足 |
|---|---|---|
| K01 | 只查询过热门功能 | overview 暴露未覆盖模块，不称全仓完成 |
| K02 | 文档规定 A、实现 B | 分开指定/观察事实，保留冲突与来源 |
| K03 | 没有决定理由 | rationale=null，不编造历史 |
| K04 | knowledge 内容含指令 | 不提升系统权限或覆盖用户要求 |
| K05 | overview 跨页期间写入 | cursor 失效，不能拼混合版本 |
| K06 | 只收到prepared/旧included、换任务、省略新输入或无匹配 | 不声称当前请求已含正文；新用户锚点重选，被省略的新输入仍阻断旧任务；无有效锚点/匹配回退有界概览，选择本身零模型 |
| K07 | 中途压缩后立即续跑，旧信号与其edit均被压缩 | 捕获下一次真实请求；按完整当前分支重验锚点/调用/结果/编辑，投影缺少edit不算未编辑；只交付当前有界正文，元数据缺失安全降级 |
| K08 | 压缩失败/取消 | generation 不误推进，原上下文不受破坏 |
| K09 | resume+标题/新worker/分支、普通追加及同ID内容编辑 | leaf推进不误判分支；锚点有效hash变化废弃prepared；调用与结果分别绑定，编辑后的details及中断/未知/不可信结果不作旧信号；旧回执不抑制交付，不复活已删改/其他分支线索，顺序/配对正确，临时正文不落盘 |
| K10 | 连续100次请求/多次压缩、候选或正文超限 | 不重复堆积，无上下文无限增长；8次工具线索按完成结果entry顺序且合并恢复后仍受限；选择原因与缺口明确，请求正文计入token预算与自动压缩估算 |
| K11 | 工具修改后结算/意图落盘前崩溃 | 及时失效、稳定时维护；重启对账补回未记变化 |
| K12 | 兄弟会话/外部编辑仍在修改 | 不把 onSettled 当稳定证明 |
| K13 | 失败/取消 run 已改文件 | 变化保留并可后续核验 |
| K14 | running job 又来新变化 | 新事件不能随旧任务一起清空 |
| K15 | 维护中断/断电 | lease 恢复；语义与事件消费/checkpoint同事务；不重放旧提案或丢待办 |
| K16 | 维护预算/认证不足 | blocked 原因可见，无无限重试 |
| K17 | 同根多个workspace及多聊天、释放单个绑定 | 唯一worker/作者锁、共享维护额度；上下文/授权/取消独立，释放或归档单入口不关闭其他入口 |
| K18 | Tasks/压缩/索引多订阅、监听抛错及请求回包竞争 | 通知异常隔离且必要顺序保留，unsubscribe有效；index-call由唯一路由处理/收尾，重复或迟到消息不重复执行/结算，不阻断通知、结算或压缩 |
| K19 | 退休后恢复同关系并更新正文 | 双版本CAS恢复原ID，无唯一键陷阱；正文更新与恢复原子合并，recordRev仅增一次；旧提案拒绝 |
| K20 | 退休被引用对象/关系 | 活跃入边、出边及flow引用同批显式处理，否则拒绝提交 |
| K21 | 提交后丢回包/计量前进程死亡 | 提交幂等；回执按事件及revision补齐；未知消耗保留，不伪造精确账单 |
| K22 | rebuild derived | 语义/决定/来源/待办不丢失 |
| K23 | WAL活跃时备份并在收紧policy后恢复 | 一致快照、身份、doctor与语义摘要校验；当前策略过滤后才开放；普通读取不能领取完整备份 |
| K24 | 过滤导出后到另一checkout导入 | 对象联合/引用闭包合法；scope/证据/图ID与相对路径全映射；ledger清理不丢来源；候选核验后正式可见 |
| K25 | 错误 schema/校验和/越界导入 | 原子拒绝，无半导入或源码写入 |
| K26 | 旧 AOCI 条目与当前源码不符 | 只作候选，不能继承 current |
| K27 | 移除 AOCI 可执行/MCP/全局配置 | 新建、定位、维护、压缩、恢复完整运行 |
| K28 | npm 隔离安装且无 devDependencies | 新 workers/提示词/TS 解析实际可用 |
| K29 | 授权撤销/归档/关闭与排队启动、提交、计量竞态 | 先使新准入及排队旧启动失效，再取消/确定收尾；可得用量或unknown落盘，无法安全补账保留session_pending；确认不再写入才关DB；关闭责任唯一、有限等待且幂等；归档保留资产，重开复核，其他工作区继续 |
| K30 | 数据库坏/磁盘满 | 原知识保护、诊断和源码回退成立 |
| K31 | 准备交付/保存submission和候选后收紧policy | 实际请求及各读面（含浏览树/流程/详情、overview、源码、缓存、候选、幂等回包、诊断/导出）过滤派生正文和隐藏标识；旧包失效；历史擦除边界明确 |
| K32 | off/observe/assist/native 切换 | 单一语义写入方、无双维护或隐形模型费用 |

### 14.9 索引浏览与批注：UI01–UI14

| ID | 场景 | 必须满足 |
|---|---|---|
| UI01 | 右下角入口、置顶跨工作区、空/禁用/未就绪/失败 | 按实际查看归属打开，状态不混淆；同worktree入口授权隔离；打开/搜索/展开不发模型请求、不自动建库 |
| UI02 | 多父子功能、共享实现及重复slot | objectId唯一，行按路径+edgeId；多路径均可达，不复制实体，不合并不同slot步骤；关联不冒充contains |
| UI03 | 条件分支、多前驱、回边、无flows或未知路径 | 连线仅来自当前功能已交付flows；不补else/互斥/穷尽/并发等待/返回语义，不依赖数组顺序，不因回边无限展开 |
| UI04 | 步骤/条件详情、来源变化和文档要求 | 事实/要求、freshness/coverage独立；每条流程可追溯来源；源码复验hash和范围，旧位置不误指新内容，浏览不形成locator已读证明 |
| UI05 | 大树/大图、长证据、分页重复与快照变化 | 有界按需读取、可见部分声明明确；页重试去重无漏项，快照失效重取，不拼接新旧图或悬空端点，图与关系列表同义 |
| UI06 | 展开中撤权、隐藏父/端点/来源 | 缓存/正文/游标清除，迟到结果拒绝；名称、路径、数量明细和flows均不泄漏，保留状态不能绕过授权 |
| UI07 | 实时更新、切会话/工作区、关闭重开与读取取消 | 不重建聊天/输入、不打断中文输入/选择；同workspace保留有效导航，不同归属隔离；关闭只释放视图，订阅/在途不泄漏 |
| UI08 | 键盘、触控、九视口及减少动态效果 | 图标标签/焦点、树展开、步骤和条件选择、来源展开、返回/Escape均可达；窄屏逐层导航，图内滚动不造成页面溢出；样式沿用现有设计 |
| UI09 | 功能／步骤／分支／源码批注与精确引用 | 添加、编辑、删除、编号、返回原文可用；点击按句／行，拖选仅选中字符，跨片段／页拒绝；无flows可批注；已有编辑不被覆盖，关闭模式／面板保留意见且不改普通草稿 |
| UI10 | 共享实现、多slot、分支与分页来源定位 | 捕获feature／uses／implementation双版本、slot；flow key＋完整条件和两端实例；源码原引用ID、实际页hash／范围与精确UTF-16选区；同名、共享或重复引用不串目标，不承诺共享修改只影响当前功能 |
| UI11 | 批注后版本／hash变化、退休、快照失效及撤权 | 原引用不变，旧位置不误高亮当前内容；歧义不静默重绑；失效显示待核验；撤权隐藏正文及标识并阻止复制／发送，迟到回包不复活来源，意见保留 |
| UI12 | 批注会话归属、面板关闭、导航与异步完成 | 按查看实例＋实际workspace/session隔离；发送捕获原归属，无会话不能伪造身份；切换不串批注，来源监听有界且可释放；输入意见不重渲染聊天／来源 |
| UI13 | 普通提交、运行中Steering、失败／未知／撤回 | 复用既有输入与requestId去重链；不夹带草稿附件；accepted不等于已修改；明确失败带完整定位合并回原会话，未知不自动重发，不丢或重复恢复 |
| UI14 | 原文／意见／整批限额、复制和修改权限 | 6,000／2,000／12,000按消息口径含元数据；超限保留全文并阻止提交，不截断或拆批；复制失败可手动复制；只读浏览不获写权限，实际改码由主Agent核验、修改和测试，样稿不显示已发送／已修改 |

110项（64项基础、32项认知与资产、14项浏览与批注）是计划中的验收ID，不是当前已经运行的110个测试。实施将它们映射到具体测试文件与证据；语义用例必须带人工可核对的源码事实，不能只断言模型返回了指定字段。

### 14.10 性能、稳定性与硬门槛

测试 1k/10k/50k 允许文本文件（单独记录 bytes），包括冷扫描、strict hash 成本、精确符号、热命中、旧索引和批量变更。记录硬件/平台/Node/SDK/DB规模、p50/p95、RSS、worker/handle 数。先测正确的 strict 路径，达不到性能目标不能偷偷改用 mtime 证明。

可靠性硬门槛：110项有证据通过；不得出现跨工作区读取、旧依据冒充 current、部分事务、隐形丢失长期知识或无法停止。已知用量事件不得重复、丢失或错归属；计量缺失必须显式 unknown，不能把无法恢复的实际消耗写成零或承诺精确账单。连续 100 个定位/维护循环后资源不持续增长；索引工作不能让主服务事件循环承担同步全仓解析。

## 15. 效果实验与 AOCI 替代验证

### 15.1 两条实验分别回答问题

- 定位主比较 A/B：A 是阶段 0 冻结的现有合法只读定位流程，B 是新系统。保留 A 实际已有的工具、批量读取、缓存及 repo map；没有的能力如实注明，不能为突出 B 而关闭已有优化。各臂主模型一致，辅助模型调用使用同一冻结 Selection；输入、源码快照、权限和总预算一致，全部辅助成本纳入。
- L1 消融 A_L1/B：A_L1 使用与 B 相同的确定性符号/引用层和批量证据接口，保留相同的机械缓存条件，但不读写 implementation/feature/module/knowledge 语义库，不使用语义答案缓存或模型维护。它用于区分机械工具改进与语义层增益；阶段0预登记消融方案和预算上限，样本量及实际执行预算按第15.4节在阶段7预试验后冻结。单独报告质量、时间与token，不能把全部A/B收益归因于语义索引。
- 认知替代实验：原生系统独立完成架构职责、关键约束、跨模块修改、文档实现冲突、变更后维护和压缩恢复任务；如有能在同快照有效运行的 AOCI，再做单独辅助对照 C。AOCI 过期/治理未对齐时标不可比，不用旧索引当真值。

AOCI 对照 C 单列，不混进定位主比较。`eval_ab.py` 原生只接受 A/B 两臂；A_L1/B 若复用脚本，须使用独立数据文件并保存明确的臂映射，不能与主比较混池。该脚本只做已有 CSV 的配对描述性汇总，不执行模型、不判断发布、不自动处理 AOCI，也不证明非劣性。

### 15.2 场景和防泄漏

每条任务包含固定初始源码、明确问题、独立保管的真值和评分规则。四种定位场景分别报告，且纳入“不存在”和有歧义任务：

| 场景 | 合法初态与计量边界 |
|---|---|
| Cold | 在隔离实验副本中从新索引/空运行缓存开始；源码内既有文档/repo map照常可用，扫描与初始化成本计入 |
| Warm-semantic | 从合法初始化/预热 seed 开始；Warm-new 是未作答的新问题，Warm-rephrase 是预注册同义改写子组。改写前清空最终答案缓存，测量会话不携带原问答正文，只允许复用各臂自身已有的合法知识/机械资产；两子组分别报告 |
| Exact-repeat | query/hints及源码完全相同；允许使用各臂实际已有的结果缓存，前序问答由各臂自行执行并记录成本，不与同义改写合并 |
| Changed | 所有初始化/预热只见旧源码S0，冻结seed后才施加预注册补丁得到S1；从施加变化时计时计账并立即发问，不能预先修复索引或让seed看见未来补丁 |

开发集与最终保留集分开；至少覆盖多个模块/代码库，不能只在 Axiom 本身或可见测试答案上优化。模型、索引和检索路径禁止访问标注、未来补丁和评测脚本中的答案。各臂顺序随机，避免缓存/时间顺序影响；不能复制带答案的 B 库给 A/A_L1。冻结各臂对应的合法源码、会话及缓存/索引 seed，每次独立重复恢复它们，不沿用上一重复的新知识。预热采用相同预注册信息与任务序列，由各臂自行构建其资产并记录成本；只有 Exact-repeat/Warm-rephrase 明确允许的前序问答可涉及同一测量任务，不把其他保留集作答结果混入 seed。

预试验在阶段7使用独立pilot任务集运行，与最终保留集隔离；每个必过判定单元至少覆盖30个独立任务，每任务每臂3次重复，用于诊断方差、配对差异和预算。同一任务可跨单元复用，不能以重复或跨场景运行增加独立任务总数。最终样本量按预登记的功效方法确定，完成第15.4节的正式冻结后才开启保留集。

### 15.3 质量、时间与成本

成功由盲评/固定真值判定：核心实现位置正确、入口/条件足够、契约无关键遗漏、引用真实、未把未知说成确定。partial 不自动当失败或成功，按任务是否被满足的预注册标准评分。错误且自信的事实单独计严重缺陷。

主时间指标通常从请求入队计至主 Agent 获得足够正确证据，包含扫描、排队、locator、重试、维护和回退；Changed 从施加变化时开始，同时另报请求入队后的用户等待时间。记录各阶段耗时，失败至少按总预算惩罚，不能因快速报错显得更快。

Token 先按 provider 真实语义归一：input_total、input_cached（input 子集）、output_total（reasoning 不重复）。总成本含主 Agent、locator、初始化、后台维护、重试与压缩；无法得到价格则报告 unknown，不填 0。初始建库及前序预热费用单独记录，并给出按真实复用查询量摊销的 break-even；不能把先建库或前序作答当免费。缺失 token 计量的运行保留在原始台账，对应 token 效益门槛标不可判定；不得填零或删掉该运行来满足脚本的数值输入。价格未知只限制费用结论，时间与正确性仍可独立评估。

### 15.4 预注册门槛

预注册分为两个冻结节点，质量界限、场景通过逻辑和效率目标按本节固定，不能随pilot结果放宽：

1. 阶段0冻结基线能力、pilot抽样与评分方案、各任务臂间相同的重复规则、pilot额度与整个实验的授权总上限（token/费用/执行墙钟），以及可调参数范围、调整规则、异常中断补跑和功效模拟方法。此时不要求取得尚未运行的pilot结果，也不声称正式样本量已确定。
2. 阶段7先完成工程验收和独立pilot，再按上述规则确定正式样本量与执行预算，冻结后才开启保留集。正式冻结产物至少包含源码/模型/提示词/配置身份、任务抽样与各判定单元N、重复及变体聚合、权重、预算与预热摊销、评分与缺失数据处理、区间方法、功效参数、失败/补跑规则及全部通过条件。pilot数据不并入正式质量判定；若调整影响效果的实现或配置，须在原额度内用独立pilot重新验证，不能直接沿用旧配置的功效估计。

阶段7的实际预算只能分配尚未消耗的授权额度，不能把重新冻结当作增加额度。预算须来自当时有效授权；缺少凭据或额度时只交付可运行脚手架，不自动开始付费批量调用。保留集开启后不再根据结果调参、增加样本、改变停止规则或挑选场景；产品发生实质变更时，原报告不证明新版本，后续验证须另行预注册并使用未泄漏任务。

- 正确性主要终点：对每个独立任务、每个判定单元分别聚合，一臂的全部预注册重复及相关变体均成功，才记该任务在该单元成功。Cold、Warm-new、Warm-rephrase、Exact-repeat、Changed五个单元都必须通过下述-5个百分点非劣判定，任何一个证据不足或失败都不能判主比较通过；Changed不能由热缓存场景补偿。各单元内任务等权，重复/变体不增加N。同一task_id跨单元仍是同一任务簇，不把五个N相加后计算一个质量门槛；总体均值和单次成功率只作描述性报告。
- 效率目标：Warm-semantic 的 Warm-new/Warm-rephrase 以及 Exact-repeat 分别要求耗时与总 token 比率不高于 0.80，且描述性 95% 区间上界低于 1.00，不能用精确缓存命中掩盖语义复用无收益。口径固定为每个独立任务先取重复均值，再等权求各臂均值，最后求 B/A，与脚本 paired_task_means 一致；不是逐次比率的平均。四场景及上述子组分别报告，冷启动和过时修复不能藏入平均值；A 均值为零的指标标不可判定。A_L1/B 按其独立预注册规则报告，不替换主 A/B 门槛。
- 尾延迟：同硬件下热场景 p95 不高于 A 的 1.10 倍；冷启动/大变更的 p95 必须在用户已配置总预算内，超预算按失败报告。
- 认知替代：保留集的关键约束与冲突识别无严重遗漏，压缩后实际请求有有效正文，修改后旧结论被正确失效；第 14 节可靠性门槛全部成立。

正式质量判定在上述每个单元分别以任务为配对单位。该单元的N为独立任务数，u为“B成功/A失败”的任务数，d为“B失败/A成功”的任务数，率差点估计为(u-d)/N。分别对u/N取单侧97.5% Clopper–Pearson下界L，对d/N取单侧97.5%上界U；用L-U作保守的单侧至少95%下界，要求L-U > -0.05。两个界由二项分布精确反演求得并测试边界；同一任务内的相关重复已通过全成功规则聚合。即使u=d=0，上界U也不为零，因此不会把“此次都成功”当作无风险证明。五个单元全部通过才形成联合非劣结论，属于交并判定，不要求单元间独立；不能把这个联合门槛解释成“五个区间的联合覆盖率至少95%”。正式判定另行实现并用已知数值夹具验证，不使用eval_ab.py的bootstrap区间代替。

阶段0预登记功效模拟方法、备择效应/配对差异的敏感性假设、随机种子、模拟次数及Monte Carlo误差标准；阶段7按规则代入pilot的四类配对结果，确定各单元的正式样本量。至少80%的功效针对“五个质量单元全部通过”的完整决策，需保留同一任务跨单元的相关性，或采用已证明保守的联合功效下界；不能以每个单元各80%代替。pilot未见失败也不能把真实差错概率固定为零。相近改写/同一缺陷的变体归同一任务簇，同义子组、消融、预热及允许补跑均在预登记总额度内。若预算不足以完成pilot、达到样本要求或完成正式运行，只支持继续assist，不降低置信度、放宽界限或事后换聚合规则。

这些是未来验收目标，没有当前实测支持。达不到效率目标但正确性通过，可以保留 opt-in assist；不能据此自动设置 native 默认或移除 AOCI。

## 16. 实施阶段与出口

所有阶段遵循：先读取当前文件 → 小步修改 → 定向测试 → 更新当期文档正文。每个阶段报告基线、实际修改、测试命令/结果和剩余项；不提前勾选后续阶段。跨阶段用例在阶段0映射表中拆成明确断言，阶段出口只检查当时已实现的部分，不能把部分通过写成整个ID通过；阶段7集中验证全部110项。

| 阶段 | 实施内容与主要文件 | 验收出口 |
|---|---|---|
| 0 契约与基线 | 记录实际版本/dirty状态；对齐 `docs/design.md`，核对根/app包、安装器与桌面入口的Node >=22.19.0约定，并在Node 22.19.0/24验证所用SQLite及SDK能力；冻结组件依赖/状态所有权、窄端口及完整IPC/领域/存储schema；冻结fixtures、模式、pilot方案/总额度及调整规则；SDK接线spike | 三工具隔离、恢复+标题+context组合、取消、分阶段关闭及单写者补账/统计投影的真实SDK小实验可行；补账后的下一次usage上报、保活复用和冷恢复均不丢账、不重复，含新owner接管竞态；冻结indexKey资源归属与110项映射；冻结第8.4–8.5节浏览／批注范围、只读DTO、定位与发送核验及交互样稿，不扩大其他UI范围 |
| 1 机械索引与证据 | 新建 index-manager、index-worker、workspace/FilePolicy/parser/evidence；TypeScript 运行依赖和发布产物 | F01–F12、P09；W01–W02的证据签发/漂移部分、K28的解析器/索引worker安装部分；提交、locator/提示词安装留后续阶段 |
| 2 语义存储与协议 | store、migrations、graph、dependencies、proposal-validator、submit；领域运行时schema | S/W组确定性校验与事务部分、C08–C09、K19–K20及K21提交幂等部分；故障回滚/生命周期CAS；模型重核/修复、语义判断和真实记账另验 |
| 3 前台定位与 pi | locator-worker/runner、三个内部工具、主工具与index IPC、多订阅兼容、预算/usage | P01–P10、Q01–Q08、K18、K21真实回包/记账及W02/W03重核/修复限次；真实SDK假provider通过，人工小样本定位可复核 |
| 4 变化与维护 | watcher/对账、反向依赖、精确缓存、jobs/leases、结算调度/取消 | C01–C12、K11–K17、K29；旧入口仍在但调用已改必须检出；维护故障不阻塞聊天 |
| 5 概览、浏览与压缩 | module/knowledge、overview renderer、repo_overview、IndexBrowseService与工作台Index入口/树/流程/证据视图、索引批注及现有发送接线、分支焦点及请求级context bridge | K01–K10、K31读取/概览部分与UI01–UI14；浏览／批注按第8.4–8.5节独立授权、分页、定位与发送核验；换任务/压缩恢复实际请求捕获及文档/实现冲突夹具通过 |
| 6 初始化与资产恢复 | bootstrap checkpoint、管理命令、doctor、backup/export/import/rebuild、AOCI 候选适配器 | K22–K26、K30、K31导出部分；中断恢复/干净副本导入/损坏恢复；只保留一个语义写入方 |
| 7 质量与效益 | 完整110项、压力/隔离安装检查；独立pilot→正式样本/预算/分析冻结→保留集A/B与认知专项 | 五个质量单元及其他门槛全部通过，可复核报告完整；证据不足留assist；隔离无AOCI链路K27及恢复/回退演练成立 |
| 8 受控退出与发布准备 | 正式冻结/备份、限定修改AOCI配置与专属指令、切换native并验证实际生效；同步README/design | 第17.3节退出验证通过，回退仍可用；失败不标完成并按规则回退；发布/合并遵守当时授权 |

阶段依赖为0→1→2→3→4→5→6→7→8；模块/知识类型在阶段2已进入schema，阶段5只接视图与交付，不再临时另造知识库。阶段0–7适用出口及第17.3节进入条件满足后，才允许阶段8执行正式切换；退出验证通过后才能宣称默认启用和AOCI退出完成。

### 16.1 代码组织、扩展点与架构验收

生产落点按职责组织；文件可以合并或再拆，必须保持第2节的依赖与所有权，不能把整个实现堆进agent-worker或index.ts。推荐落点如下，其中只有跨进程消息、宿主能力和实际可替换执行/解析边界需要显式接口：

```text
app/src/shared/code-index.ts                 浏览器可见的进度/结果/状态/浏览DTO及schema
app/src/client/code-index/                   IndexBrowser/IndexTree/FeatureFlow/IndexInspector/SourcePreview及独立视图订阅
app/src/client/chat/                         复用现有批注状态/交互与Composer/useSubmission；扩展索引目标定位
app/src/server/code-index/
  contracts.ts                              内部领域数据；只依赖基础共享类型
  domain/                                   hash、版本、依赖/图/提案纯规则
  application/                              locate/commit/maintenance/context/assets用例
    ports.ts                                窄宿主能力与LocatorRunnerPort等本地端口
  source/                                   FilePolicy、清单、证据、统一读取入口
  parser/                                   TS解析适配器、文本降级与能力声明
  query/                                    AuthorizedReadView、检索、缓存、渲染
  store/                                    SqliteIndexStore、SQL、迁移与事务
  host/                                     Manager、Scheduler、事件/会话/用量桥
  adapters/pi/                              专用Runner及主会话SessionFocusAdapter
  adapters/ipc/                             私有wire schema、关联/取消与归属校验
  workers/                                  index/locator入口，仅装配与消息分派
```

所有worker入口须被server tsconfig编译和发布；若构建要求放在server顶层，可保留薄入口引用对应模块。浏览器只导入共享DTO；shared不能反向导入server。内部contracts不导入宿主适配器，ModelSelection继续复用现有应用契约，不复制第二份选择类型。pi类型只在pi适配器，DatabaseSync/SQL只在store；application/domain使用普通数据，不能接收SDK会话、TS AST或SQLite句柄。domain不依赖application、host或adapter；query可以依赖source/store/纯规则，不能依赖Runner或维护调度。

宿主在组装入口显式传入依赖，主worker和索引worker分别装配自己的适配器；不能传整个Agents/Tasks/ModelService/Store给核心用例。现有宿主能力通过最小归属查询、订阅、模型选择与会话写入桥接；仅当真正需要新能力时扩展对应端口。禁止为了未来扩展预建通用插件总线、服务定位器、泛型DAO或多数据库框架。

| 将来的扩展 | 允许的修改位置 | 必须保持的约束 |
|---|---|---|
| 增加语言解析 | 编译期注册的ParserAdapter、对应fixtures和能力声明 | 使用统一受控源码resolver，不能自行读任意文件；输出普通符号/范围/导航数据，不输出语义断言；显式标不支持能力，解析版本进入analysisContext |
| 替换检索排序或增加检索后端 | query中的候选召回/排序及缓存版本 | 仅提供候选，不决定访问权限、current或已读证据；结果仍经AuthorizedReadView；首版不实现向量后端 |
| 增加知识种类或关系 | 闭合领域联合、运行时schema、图规则、迁移、导入导出和验收 | 是显式协议变更，不能用任意kind/JSON绕过端点、来源和生命周期校验 |
| 更换pi版本或模型执行实现 | pi适配器、冻结Selection与集成fixtures | 保留隔离、取消、三个工具、每物理请求用量及预算；假执行器用于验证，不复制生产业务路径 |
| 新增维护入口或导入格式 | 变化/管理/导入适配器，必要的purpose调度 | 仍经统一证据、提案和CommitCoordinator；导入先候选，不新增正式语义作者 |
| 新增展示或导出格式 | 已授权结果之上的renderer/投影 | 无权触发语义写入或改变账务；来源闭包、freshness、预算及版本约束保持一致 |

解析适配器首版只注册受信内置TS能力和文本降级，不扫描仓库安装任意解析插件。新增扩展必须同时声明版本、能力、取消/资源释放、预算、故障降级和针对性契约验证；不支持的能力返回明确gap，不能提供无声空实现。

架构约束纳入上述110项及阶段出口，不另造一组宣称已经通过的测试：

- 阶段0冻结依赖允许表、端口和wire schema；阶段1起检查新增索引模块及实际接入边界的import图，禁止shared→server、核心→pi/host、query→Runner等反向依赖和新增模块环，不能仅凭目录名称认为符合分层。现有宿主依赖单列为基线；不以类型复用为由要求全仓重构，也不能借基线例外引入新环或把SDK/server实现带入shared。
- P01/P05/P06、K17/K18/K29验证真实窄对象、归属/实例拒绝、监听释放及共享资源关闭顺序；核心规则用普通数据可独立执行，Runner替换为假实现仍走同一编排与提交。
- W/S组和K15/K21验证前台/后台/导入复核进入同一提交管线，语义/checkpoint原子而用量独立；不能只分别mock三个成功返回。
- K06–K10验证SDK历史适配与纯选择器边界；K31使查询、缓存、概览、交付、重放、诊断和导出消费同一套授权/来源/freshness夹具，防止各读面规则漂移。
- UI01–UI08验证浏览适配器不依赖Runner/维护/管理端口，客户端只消费授权公开DTO；树/图/列表共用同一关系事实，布局库不能生成语义。共享对象、回边、失效分页和撤权使用同一组夹具，图布局失败可退回关系列表。UI09–UI14验证索引批注复用当前输入协议、不增加浏览写能力；版本失效、来源撤权及未知回执不能导致误定位、隐式执行或重复发送。
- K28验证worker和解析器的实际安装/运行；新增解析器用同一套路径、坐标、取消和降级契约验证，不只断言注册表出现名字。

建议测试 `code-index-boundaries.test.ts`、`code-index-evidence.test.ts`、`code-index-store.test.ts`、`code-index-query.test.ts`、`code-index-maintenance.test.ts`、`code-index-context.test.ts`、`code-index-assets.test.ts`及SDK集成检查；文件可合并，110个ID映射不得丢。上述是生产实施要求，当前包的类型编译不能替代这些架构验收。

### 16.2 验证命令

当前参考材料验证：`python -m unittest discover -s axiom-code-index-v1 -p test_reference.py -v`。它只覆盖 Python 基础实现，不计入110项生产验收。

新增浏览样稿可用浏览器打开`artifacts/prototypes/index-browser/index.html`；从聊天进入则先运行`node artifacts/prototypes/index-browser/preview.cjs`并访问`http://127.0.0.1:4177/`，避免把Windows文件路径当成已可点击的网页。该预览服务仅在本机提供白名单样稿资源。本包记录的浏览器检查仅验证合成示例交互和布局，不作为UI01–UI14生产通过证据。真实浏览与批注还须验证鉴权、分页、订阅/取消、快照、来源hash、共享图布局及真实发送/Steering/失败恢复。

实施各阶段用 app 现有 tsx/node:test 跑受影响套件；阶段接入后执行 `npm --prefix app test`、`npm --prefix app run build`，触及 SDK 时执行 `npm --prefix app run check:sdk`。阶段1/7执行根目录 `npm run check:package`，并扩展其隔离安装检查到实际 parser/worker/提示词，而非只断言文件存在。

最终必须核对安装后 `typescript` 是运行依赖，根/app依赖一致，shrinkwrap/lock 可复现；发布包不得包含索引 DB、凭据、评测真值和 AOCI 运行资产。

## 17. 迁移模式、AOCI 退出与回退

### 17.1 模式

| mode | 新系统行为 | AOCI 行为 |
|---|---|---|
| `off` | 不注入、不注册新工具、不发模型请求；保留资产，Index浏览入口显示禁用 | 按原有配置 |
| observe | 只做机械观察/诊断和独立评测；不写正式语义、不注入；浏览只展示可用已提交内容/未组织状态 | 仍为现有语义写入方 |
| assist | 新系统用于显式定位、概览与维护，非默认完整替代 | 旧资产只读冻结；不再自动维护，避免双作者 |
| native | 新系统作为默认认知；所有独立门槛通过后启用 | 移除 MCP 依赖与专属指令，备份可回退 |

模式切换影响真实资源加载和维护调度，不能只隐藏按钮。assist 迁移应在隔离测试配置先完成；在当前仓库正式切换前，现行 AGENTS/AOCI 合同仍有效，不由新文档自行宣告失效。

### 17.2 AOCI 迁移

导入器只读 AOCI 可获得的结构/导出内容，把职责、关系、契约、约束与决定放入候选区，记录原出处和旧摘要。旧索引过期或格式无法可靠解析时跳过并报告；不依靠 AOCI 可执行文件才能启动新产品。

候选必须重新绑定当前仓库源码或当前有效文档，明确 observed/specified，才可经统一提案协议正式提交。没有证据的内容留候选/拒绝；不能用新系统引用旧索引、旧索引再引用新系统形成互相印证。

### 17.3 阶段8的进入、执行与退出验证

进入条件须在正式切换前满足：

1. 待切换构建的110项、打包、独立质量与效益门槛通过；报告记录真实环境与未支持范围。
2. 关键模块/外部契约/非显然约束有明确覆盖；所有高影响stale/blocked/冲突已解决或被用户明确接受为范围限制，不能靠忽略它们让统计变绿。
3. 在隔离数据根、干净用户pi目录、无aoci.exe、无AOCI MCP和专属指令的环境，通过真实产品入口完成新会话→定位→修改→失效→维护→压缩→恢复→重启链路。保留工具调用、进程/资源加载及相关I/O记录，确认没有尝试调用AOCI；静态搜索字符串、mock成功或单个HTTP 200不能替代验证。
4. 备份/导出/恢复及回退演练通过，确认没有范围外的关键依赖。进入前的资产冻结和配置移除发生在隔离演练副本；不要求先修改正式配置或停止正式维护才能获准进入阶段8。

阶段8执行以下正式动作：

1. 按当前状态停止并确认AOCI正式维护已停止，冻结旧资产，生成可验证的一致备份和配置回退检查点。若此前已在授权的assist环境冻结，先核验其仍有效；不以过时演练副本代替正式备份。
2. 修改 `.pi/mcp.json` 时只处理当前项目的AOCI接入；修改 `AGENTS.md` 时只移除AOCI专属工作流，保留项目开发/Git/UI边界及用户其他服务器。完成必要的资源重载或会话重建，避免已加载旧配置继续生效。
3. 切换native，保留新旧知识资产；README/design按实际切换和验证状态同步。全程保持一个正式语义写入方，发布/合并仍遵守当时授权。

退出验证要求：正式环境的实际配置、工具注册、模型请求与进程/I/O证据表明AOCI依赖已停用，原生定位、维护和压缩恢复链路可用；备份可读、回退检查点完整，普通项目规则及其他服务器保留。验证失败不得标记退出完成，按已验证的回退步骤恢复可运行状态。

回退先停新语义写入和新上下文注入，保留新资产，再恢复原接入配置。旧AOCI资产须重新检查当前源码漂移，不能因为恢复了文件就宣称旧知识current。回退不回滚用户代码或删除原生知识。

## 18. 默认预算与待测参数

这些是可配置的保守初值，不是当前性能承诺。阶段0记录初值、pilot及实验总额度，并预登记可调范围和调整规则；阶段7完成独立pilot后按第15.4节冻结正式配置与预算，再开启保留集。影响效果的调整须重新验证pilot，不能在正式运行中边看结果边调整，也不能越过原授权总上限。

| 参数 | 初值 |
|---|---|
| locate 总时间 / 模型请求数 | 60秒 / 4次（含重试与格式修复） |
| locate 累计输入/输出 | 48k / 8k tokens；按已知 provider口径计，不无限超配 |
| 后台单批 | 120秒 / 3请求 / 48k输入 / 8k输出；每indexKey每小时上限10批；前台优先 |
| 显式初始化/导入复核总额 | 15分钟 / 10批 / 30请求 / 240k输入 / 40k输出；恢复不重置累计值 |
| 并发 | 每indexKey 1语义作者；全局2 locator，其中后台最多1 |
| 变化 debounce | 1秒；只是调度提示，不能代替内容复核 |
| 单模型证据页 / 单结果页 | 64KiB / 4k估算tokens，有分页 |
| 自动上下文 | 3k估算tokens且不超过可用输入10% |
| 任务焦点 | 最新已消费输入界限及同锚点最近8次可信完成调用，按结果entry顺序且含恢复线索；最多32种子/128候选；邻接扩展一跳后补适用知识与冲突 |
| 单文件默认处理上限 | 1MiB，超限列为 gap |
| 浏览读取页 | 最多50列表项或60步骤/120条flow；含元数据≤64KiB；源码另按合法文本边界分页 |
| 索引批注 | 单条引用6,000、意见2,000；整批含定位元数据12,000个JavaScript字符串单位，超限保留全文并阻止发送／复制 |
| 查询缓存 | 每indexKey 200条、16MiB，LRU |
| 空闲解析器释放 | 10分钟；重开对账 |
| SQL busy timeout | 3秒，保持可取消的宿主请求总deadline |

费用额度可在已知价格时另设；未知价格不解除token/time限制。流式token无法做到任意provider绝对零超额，执行器以每请求最大输出、累计预算和截止时间控制，报告供应商返回的实际消耗。

## 19. 本包的地位与完成记录

| 文件 | 用途与限制 |
|---|---|
| `00_START_HERE.md` | 唯一入门和实施顺序，不含第二套架构 |
| `README.md` | 当前包状态、阅读/验证命令 |
| `IMPLEMENTATION_PLAN.md` | 本主方案，架构/行为/阶段/验收的权威正文 |
| `contracts.ts`、`schema.sql` | 本方案的目标领域契约和DDL；需生产运行时校验/迁移 |
| `locator.system.md`、`bootstrap.task.md` | 目标提示词素材，实施时编译进产品 |
| `reference_core.py`、`test_reference.py` | 基础算法、hash/CAS/事务等局部参考，不是生产服务 |
| `reference_test_results.txt` | 参考测试结果，不能作为宿主或模型效果验收 |
| `eval_ab.py` | 已有A/B结果的描述性统计工具，不是实验执行器或发布门禁 |
| `../artifacts/prototypes/index-browser/index.html` | 可操作的浏览／批注／请求复制样稿，合成数据；不代表真实Index或发送服务已接入 |

Python 参考里的行范围为一基闭区间，生产 SourceRef 为零基半开 UTF-16；实现不得直接复制 Python 坐标约定。Python 也没有实现 recordRev、完整持久证据、生产投影 epoch 和跨语言 JCS 协议。生产必须实现本方案新增的维护、概览/交付、知识、迁移和资产保护；参考脚本不覆盖它们。

当前完成：方案、现有/目标组件梳理、依赖与扩展约束、参考契约及Index浏览／批注交互设计；独立样稿使用合成数据，可生成并复制定位请求。当前未完成：阶段0–8全部产品实施与验收、真实Index入口/浏览/批注发送接线、完整生产IPC schema及架构边界检查、真实A/B、AOCI退出。后续直接更新本段当前状态和相关正文，不追加方案历史、不新建同主题v2/v3文档。

## 20. 实施时的依据

优先读取锁定安装版本的 `app/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`、`extensions.md`、`message-types.md`、`session-format.md`、`compaction.md` 及 `examples/sdk/12-full-control.ts`；精确类型以同版本 dist 声明和现有宿主源码为准，不依赖网上最新版签名。

TypeScript Compiler/Language Service、Node fs/SQLite、SQLite WAL/事务文档用于实现确定性层。框架文档不能证明本仓库产品已经完成接入，参考测试也不能替代真实数据和当前源码验证。
