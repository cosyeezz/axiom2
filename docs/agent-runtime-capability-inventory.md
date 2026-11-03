# Axiom Agent Runtime 全面能力统计与抽象边界

> **结论：可以抽象，但不是把 Pi 的几个入口换个名字。** 当前代码对 Pi 的依赖同时分布在 Agent 执行、原生存档、资源配置、模型调用和宿主业务投影。建议上层只依赖 Axiom 自有契约，底层分别实现这些边界，而不是形成一个拥有全部能力的“大 AgentRuntime”。
>
> 本轮是当前工作树的静态统计、语义审计和接口设计，**没有实施运行时替换，也没有执行产品测试、模型请求或 DSH**。

## 1. 交付与统计结论

| 产物 | 内容 |
| --- | --- |
| 本文 | 统计口径、完整能力分类、接口族、现有契约缺口及后续验收 |
| [完整能力矩阵](evidence/agent-runtime-capabilities/capability-matrix.md) | **151 条能力与约束审计项、14 个域**；逐项列主责、现状、建议端口、语义和源码 |
| [全量依赖附录](evidence/agent-runtime-capabilities/pi-coupling-appendix.md) | **94 个直接依赖文件、100 个包内去重导入符号**，全部列出并映射能力ID |
| [机器统计](evidence/agent-runtime-capabilities/pi-coupling-summary.json) / [原始清单](evidence/agent-runtime-capabilities/pi-coupling-inventory.json) | 模块锚点、绑定、引用位置、源码SHA256、依赖图及统计限制 |
| [能力数据](evidence/agent-runtime-capabilities/capability-matrix.json) / [能力汇总](evidence/agent-runtime-capabilities/capability-summary.json) | 可复核的分类源数据；全部94个直接依赖文件均有至少一项分类 |
| [复现说明](evidence/agent-runtime-capabilities/README.md) | 统计脚本、校验/渲染方法及验证边界 |
| [既有适配器契约](agent-runtime-adapter-contract.md) | 核心接口、输入队列参考类型及停止/失败语义；本报告补足全面能力范围 |

### 1.1 源码规模与直接依赖

扫描范围是 **`app/src` 的当前磁盘工作树**，含 tracked/untracked 代码；排除 `vite-cache`、`node_modules`、`.git`。不是全仓任意文件扫描，仓库外扩展和安装资源不在数字内。

| 指标 | 当前快照 | 应如何解释 |
| --- | ---: | --- |
| 代码文件 | **600** | server 269、client 259、shared 72 |
| 代码文本行 | **64,447** | server 36,984、client 22,554、shared 4,909；非去注释逻辑行 |
| 直接存在 Pi 字面量模块引用的文件 | **94** | 全在 server；client/shared 直接引用均为0 |
| 显式 type-only 文件 | **43** | mixed 30、value-only 21；仅为声明语法分类 |
| 含非纯类型引用锚点的文件 | **51** | 不是“只有51个文件需要关注”，更不是实际执行文件数 |
| Pi 字面量模块引用锚点 | **127** | 118 静态import、2 dynamic import、7 import.meta.resolve |
| 本地导入绑定 | **277** | 显式type 165、value 112；别名及重复声明分别计数 |
| 包内去重导入符号 | **100** | 按`(package, importedName)`去重，不是100个方法 |
| 导入绑定的直接call/construct语法引用 | **155** | **不含通过session实例调用的方法，不能当全部Pi调用数** |
| 可解析语法图反向依赖闭包 | **153** | 94 direct + 59 indirect；含类型依赖，不是运行时调用图 |
| 私有JS相对路径 | **8处 / 6模块 / 5文件** | 是有限形态识别；不是所有非公开API依赖的总数 |
| 计算式SDK版本resolve | **1语法位置** | 该位置遍历3个包；不在127个字面量锚点中 |
| 借Pi安装目录加载第三方依赖 | **2处** | proper-lockfile、yaml；此外另有包元数据读取 |
| 人工矩阵涉及的源码文件 | **163** | 不限于直接Pi import；包括宿主和上下层语义消费者 |

绑定与模块锚点是不同单位：一个import可导入多个符号，一个文件可导入多个包。不能把上述列相加，也不能用它们推算重构工时。

### 1.2 按包统计

| Pi包 | 引用文件数 | 字面量锚点 | 导入绑定 | 包内唯一符号 |
| --- | ---: | ---: | ---: | ---: |
| pi-coding-agent | 71 | 76 | 152 | 51 |
| pi-ai | 35 | 39 | 111 | 43 |
| pi-agent-core | 9 | 9 | 9 | 2 |
| pi-mcp | 2 | 2 | 4 | 3 |
| pi-tui | 1 | 1 | 1 | 1 |
| 去重或求和后的合计 | **94个不同文件** | **127** | **277** | **100** |

文件数跨包重叠；根包和app包均声明6个Pi包，但 `pi-codemode` 没有 `app/src` 直接导入。依赖声明、资源启用和源码import是三个不同事实。

### 1.3 快照与可复核性

- HEAD：`da7c037fa0157a74a750ec044d165c73ca751b58`；安装版 Pi coding-agent：**1.1.0**。
- 当前是包含其他任务修改的脏工作树，**HEAD并不代表所有被审计内容**；每个代码文件的字节SHA256保存在原始清单。
- 本次统计 manifest SHA256：`9f42b477d57636707e0e1d2a078fee8f33357a1504d89e4f7931f8e80043dd78`。
- 审计期间源码有外部并行变更；最终复核了费用sidecar及派生存储的相关变化，未覆盖、回滚或归入本轮修改。
- 这是逐文件观察到的快照，不是原子文件系统快照。未来重新运行时数字、行号和hash可能变化，不能把旧数字继续称为当前工作树事实。

## 2. 归一化能力清单：14域、151项

**151是本轮审计的语义分类粒度，不是151个SDK方法、151个待实现接口或151项已上线功能。** 同一能力会涉及多份源码；同一源码也可能实现多种能力。通用协议能力与特定provider兼容要求分别保留，不能由此推导成本或完成率。

| 域 | 审计项数 | 应覆盖的能力 |
| --- | ---: | --- |
| E 执行环境与许可 | 10 | 唯一执行池、lease/generation、双重许可、解释器/环境计划、资源身份、热复用与进程树回收 |
| S 会话与运行生命周期 | 8 | 创建/绑定、run、settled、分级停止、close、部分初始化清理、保存水位、runtime固定 |
| I 输入与队列 | 11 | prompt/steer/follow-up、附件、inputId、受理/消费/保存、原生队列、撤回、未知投递和通知回执 |
| V 事件、观察与交互 | 10 | 消息/思考/工具/phase/retry、身份、原生保存证据、请求观察、背压、问答和展示缺口 |
| T 工具与权限 | 10 | 工具目录/schema/result、调用IPC、原生文件/shell、记忆守卫、子代理权限、阶段撤工具、副作用未知 |
| R 资源、提示词与扩展 | 12 | 目录/来源/技能、提示词组合、环境preview与runtime、扩展/MCP、安装管理、配置存储和内置资源 |
| C 配置安全点与重载 | 8 | 安全点、模型revision、历史/扩展同步、网络重绑、暂停、重载、无伪用户续接和应用回执 |
| A 原生存档与只读投影 | 12 | 物理身份、严格只读、活动分支、有效上下文/原文、消息工具图片、分段、正文缓存和helper |
| B 分支、重写与恢复 | 11 | fork资格与事务、原生分支、空分支、草稿还原、CAS重写、废弃marker、工具配对和服务恢复 |
| P 上下文压缩 | 14 | 策略、快照/单写者、draft/commit、记忆、无工具摘要、fileOps、缓存前缀、晚结果冲突和原生安全网 |
| M 模型、认证及独立推理 | 17 | ModelGateway、目录/别名、凭据/登录/代理、3类自有provider、单次推理、quota、deferred、协议/失败 |
| U 请求观测、用量与费用 | 10 | 实际模型、token/cost/provenance、占用、压缩费用、并发/延迟、迟到结算、账本与sidecar |
| J 任务、记忆与标题业务 | 10 | 委派/追加/取消/精确结果、工作预算、结果事实源、记忆查询/组织/注入、后台标题及跨作业停止 |
| H 上层API与UI契约 | 8 | 授权/幂等回执、软删归档、树分页、交付、wire权威/背压、文件服务和能力门禁 |
| **总计** | **151** | 逐项语义及证据见完整矩阵 |

### 2.1 当前实现状态

| 静态状态 | 项数 | 结论边界 |
| --- | ---: | --- |
| live | **136** | 现有业务链路源码可见；**本轮未执行验证**，不表示中性接口已实现 |
| partial | **8** | 已有部分链路，但保证/观测覆盖有限；不能提高承诺 |
| helper | **1** | 已有纯构件，未发现生产接线 |
| gap | **2** | 目前未桥接或不可直接移植 |
| new | **4** | 多运行时需要的新设计，产品尚未实现 |

状态按主行为接线及专门已知缺口分类；每项semantics中的“需/应/不能”可能是迁移要求，不是现有保证。live不意味着所有子能力或中性接口均具备，例如S04的live仅指当前强制stop，通用可恢复软中断仍需独立能力证明。

8个partial：S07保存水位、M15 deferred、M16 provider终结协议、U04压缩费用、U05请求观测、U07迟到结算、U10计费完整性、H06取消/背压。

2个gap：V09扩展人类问答、V10原生TUI自定义展示。1个helper：A12 canonical观察/投影/发布等构件。4个new：E10注册/兼容/准入、S08会话runtime固定、V07中性事件序号/背压/gap、H08 UI能力门禁。

### 2.2 应收口的五个主责边界

| 主责 | 项数 | 不意味着什么 |
| --- | ---: | --- |
| Runtime适配 | **40** | 不是把执行池、任务调度也交给runtime |
| 原生存档适配 | **23** | 不是通用messages CRUD，也不是把授权和显示缓存迁走 |
| 资源配置适配 | **14** | 不是允许适配器自行下载、安装和扩大权限 |
| 独立模型网关 | **17** | 不等于AgentSession；可先保留Pi实现 |
| Axiom宿主保留 | **57** | 不是“无需抽象”；这些服务也应只消费自有DTO |
| **总计** | **151** | 每项仅一个主责，协作约束见逐项语义 |

## 3. 应抽象哪些接口

### 3.1 依赖方向

```text
UI / API / Tasks / Memory / Title / Ledger / File Services
                  │ Axiom DTO / 宿主应用服务
                  ▼
  RuntimeRegistry + ExecutionHost + 场景准入与授权
       │                 │                 │
  RuntimeAdapter    NativeArchive      ResourceAdapter
       │            Reader + 可选写端口      │
       └──────── Pi / DSH / 其他实现 ───────┘

  ModelGateway ── Pi model runtime / 自有provider / 其他模型实现
       ▲
  主运行的请求桥、记忆/标题/其他独立推理作业
```

宿主控制准入和进程生命周期；adapter声明需求、准备环境、适配底层能力。底层原生对象不能反向泄漏到业务层。ModelGateway能否被某个runtime的原生agent loop调用，需要单独的可信provider/transport桥，**不是两个接口存在就自动接通**。

### 3.2 接口族目录与现有契约映射

下面是**接口族与职责目录，不是冻结的TypeScript SDK**。族内可拆多个版本化接口；不要求每个adapter实现全部可选能力。

| 接口族 | 主要审计ID | 需要表达的能力与约束 | 与既有契约的关系 |
| --- | --- | --- | --- |
| `RuntimeRegistry / RuntimeCapabilities` | E10、S08、H08 | runtime/contract版本、能力revision、解释器要求、场景准入、结构化unsupported、旧会话归属 | **新增设计**；现有资源CapabilityCatalog不能代替 |
| `AgentRuntimeAdapter / RuntimeBinding / RuntimeRun` | E04、S01–S07、I01–I05 | prepare/bind、permit后begin、submit、finish、stop、close、初始化失败清理和固定身份 | 沿用最小核心；补清理/保存证据DTO，不能承诺任意flush |
| `InputQueuePort` | I06–I09 | 结构化队列、inputId、原子撤回、保留true/false/unknown、消费竞争 | `input-queue.v1`已有参考；原生队列私有布局在Pi实现内 |
| `InterruptionPort` | S04、C05 | 软中断、暂停边界与宿主强停分级，停止强度不可静默降低 | `interruption.v1`需完整DTO；当前用户stop仍回收worker树 |
| `RuntimeEvent / EventSink` | V01–V08、H05–H06 | 中性消息/工具/重试事件、身份、seq、gap、背压、关闭水位 | `HostPorts.emit`需补有判别的事件与receipt；不能复用wire序号 |
| `InteractionPort` | V09–V10 | interactionId、ask/respond/cancel/timeout与可呈现内容；TUI可声明不支持 | `interaction.v1`尚未完成；当前产品没有通用扩展问答桥 |
| `ToolDescriptor / ToolInvocation / ToolResult` | T01–T10 | schema、namespace/exposure/annotations、结构化结果、call身份、取消、unknown和权限 | `HostPorts.invokeTool`需完整中性schema；现有工具投影有裁剪 |
| `ConfigurationPort` | C01–C08、R06、R08、T08 | 可操作安全点、revision/CAS、模型/网络/工具/资源应用、实际回执、reload续接 | `configuration.v1`待细化；普通stream事件不是可写安全点 |
| `NativeArchiveReader` | I10、A01–A11、U01/U03/U08 | 不创建agent的只读验证、分支/上下文/原文投影、图片/工具详情、游标及usage codec | `native-history.v1`需独立存档注册/版本与DTO，不交出SessionManager |
| `NativeBranchPort` | B01–B06 | 原生fork/rewrite、源叶不变、版本校验、空分支和事务补偿证据 | `native-branch.v1`待细化；宿主准入、DB和通知仍在外层 |
| `NativeRecoveryPort` | B07–B11 | 损坏/不兼容/占用分类、失败尾修补、工具unknown配对、隐藏控制、原生恢复 | `native-recovery.v1`待细化；服务恢复意图/child顺序仍在宿主 |
| `NativeContextPort` | P02–P13 | snapshot/draft/apply/inspect、原生checkpoint、单写者、缓存可降级、冲突与uncertain | `native-context.v1`待细化；离线写必须证明writer已释放，不能任意append |
| `ResourceCatalog / InstructionComposer / ResourceLifecycle` | E05、R01–R12 | 发现/优先级、技能/提示词、preview与实际环境、扩展/MCP、原生配置codec | **从原契约拆出的明确边界**；显式安装/授权/版本发布仍由宿主管理 |
| `ModelGateway / CredentialProviderBridge` | M01–M17、U05/U06 | 模型descriptor、目录、凭据解析、stream/complete、optional deferred、序列化/签名、failure和测量 | 独立于AgentRuntime；公开DTO，不泄漏Pi ModelRuntime/Model/Usage |
| `HostPorts / HostApplicationServices` | E01–E09、J/H、U02/U07–U10 | 执行许可、工具调用、事件、账本结算；Tasks/Memory/Title等各自保留应用服务 | 核心HostPorts保持小；不把所有宿主业务变成adapter可任意调用的RPC |

原生只读reader与在线写端口应分离：浏览旧会话不需要启动原生agent、加载扩展或获得写权限。分支、恢复和压缩等写操作则需要绑定或证明writer释放，且接受宿主授权、版本和唯一写者检查。

### 3.3 中性数据契约至少包括什么

| DTO族 | 必须保留的信息 | 禁止用什么替代 |
| --- | --- | --- |
| 执行身份 | workspace/session/run、lease、worker instance、generation、permit、configuration revision | 当前UI会话、全局可变current run |
| 输入及交付 | inputId、purpose/kind、附件引用、mode、accepted/consumed/persisted、unknown、业务通知身份 | 相同文字去重、Promise成功、末条助手消息 |
| 运行事件 | eventId/seq、原生关联、message/toolCall/attempt、内容类别、phase的native/host-inferred/unknown来源、gap、terminal和保存证据 | WebSocket seq、delta等于持久记录、显示推断冒充原生phase |
| 原生档与投影 | runtime/schema/nativeRef、物理generation、活动branch/leaf、context revision、opaque anchor、来源/完整性 | 裸文件路径、普通messages数组、SQLite软删状态 |
| 配置应用 | requested/applied revision、能力revision、安全点证据、拒绝/失败/partial/unknown、重载模式 | 目录选中即执行成功、SDK事件回调即写锁 |
| 工具 | descriptor与schema、exposure/namespace、callId/run/lease、参数、content/structuredContent、error/cancel/unknown、可用usage | 任意SDK对象、仅UI摘要、取消即副作用未发生 |
| 推理请求及费用 | run/lease/request/attempt、purpose、configModel/physicalModel/responseModel、measurement/pricing/settlement、sourceEntry/checkpoint/job | UI选中模型、HTTP次数、未知写0、当前价格回填历史 |
| 关闭与恢复 | 未begin也可close、退出/隔离证据、未决输入/事件/费用、持久性等级、恢复分类 | 强杀即flush成功、没有句柄即无需清理、恢复失败建空档 |

字段分散存在于当前代码中，不表示已有统一DTO；各DTO仍需要版本化定义和离线契约测试。

## 4. 关键发现：只去掉import远远不够

### 4.1 纯类型引用也可能是高风险原生耦合

43个显式type-only文件并不都是“换个类型就结束”。例如：

- [native-queue.ts](../app/src/server/agents/native-queue.ts)读取原生队列内部布局并同步clear/rebuild；文本镜像无法提供原子撤回。
- [session-safe-point.ts](../app/src/server/session-safe-point.ts)包装 `prompt/continue/prepareNextTurnWithContext/finishTurn` 四个hook；需要的是原生可操作串行边界。
- [costs.ts](../app/src/server/costs.ts)及账本消费者依赖原生历史/usage/checkpoint的语义；删除type import不会消除codec耦合。

反过来，client/shared没有直接Pi import，也不等于完全中性：thinking、followUp、toolResult、final_answer、历史锚点、费用来源和wire权威仍需要显式契约。

**现有phase有宿主推断，不能当原生事实。** [transcript.ts](../app/src/server/transcript.ts)的displayPhase会把缺少原生phase的非流式成功`stop`助手消息推断为`final_answer`，部分Responses流式提示亦有兼容路径；这个显示值用于UI交付和fork资格。此处不改现有行为，但新中性DTO必须区分原生phase、宿主显示推断与unknown，不能反向声称当前已禁止所有phase推断。

### 4.2 最脆弱的Pi适配面不只公开SDK

- [axiom-prompt.ts](../app/src/server/axiom-prompt.ts)：私有system-prompt模块、`_preparePromptAndToolLoadout`等桥接；系统指令差分不能挪到通用层猜测。
- [pi-settings-storage.ts](../app/src/server/pi-settings-storage.ts)：严格绑定 **1.1.0** 的 `FileSettingsStorage.prototype.withLock`补丁及proper-lockfile；这是版本兼容边界，不是普通设置JSON读写。
- 资源loader/packageManager、MCP config/auth、原生队列、安全点和压缩guard也需要明确兼容检查，不能只对外层包做semver判断。

### 4.3 三种“历史”与三种“结束”必须分开

历史：**原生持久档/恢复语义、UI分段/正文视图、SQLite业务归档/软删**。结束：**原生idle/agent_end、消息/输入保存、宿主结果交付和物理资源关闭**。

- [transcript.ts](../app/src/server/transcript.ts)的只读路径用parser+inMemory，避免浏览时由open修尾换行；活动branch/context_edit不能被全树遍历替代。
- message_end发生在native append之前；完整可读磁盘记录也**不等于fsync**。
- fork/重写/压缩需保留原生结构与宿主事务补偿，恢复补“未知工具结果”不能重做副作用。
- Axiom异步压缩与原生70%安全网是不同控制层；晚摘要不能覆盖更晚原生压缩。

### 4.4 工具、扩展和UI目前并非全可移植

- 当前是**5个宿主工具 + 8个可注册原生工具**，不是固定13个active工具；平台、settings、扩展/MCP改变实际集合。
- 子代理工具allowlist、禁递归、摘要阶段撤工具是具体约束；shell仍有OS副作用，不能宣称只读OS沙箱。报告2000字符等政策也不能说成存储硬截断。
- 当前 `bindExtensions({mode:"rpc",onError})` **没有uiContext**。RPC mode不代表Web端已有扩展confirm/select/input/custom/editor桥；默认false/undefined不是用户的真实回答。
- canonical coordinator/observer/publisher/overlay等是现有构件，未发现生产接线；不据此承诺原生正文authority、增量历史性能或有界CPU/RSS/IO收益。

### 4.5 AgentRuntime与ModelGateway必须分层

[memory-worker.ts](../app/src/server/memory-worker.ts)以 `completeSimple` 执行query/organize/title，完整独立context、无工具；不需要AgentSession。凭据授权/配置发布/网络worker/quota账户属于宿主；provider协议、原生凭据codec和实际推理属于模型网关适配。

必须区分四条链：

| 链 | 关心什么 | 不代表什么 |
| --- | --- | --- |
| 请求并发/RPM | provider级start/end与http/call精度计数，owner释放；当前没有完整模型/路由/终结原因字段 | token费用、完整request记录、上游终结或远端已停止计费 |
| 延迟遥测 | payload/response/first text/thinking/tool/end及attempt | 历史账单、精确网络活跃总量 |
| token/cost账本 | 真实usage、价格来源、unknown→实测修订、checkpoint去重 | HTTP请求次数、实时供应商法定账单 |
| provider quota | 账户窗口/余额/重置及缓存时效 | 本地token/$、模型实时权限 |

后台记忆先记录unknown，再按同usageId更新实测；宿主先处理usage再过滤取消。压缩worker等待accounting，主进程取消后仍接billing。**这些是有限drain窗口内的实现，不保证强杀后恢复远端已计费用。**

当前请求observer、latency、memory usage、compression call、历史账本的关联ID各有来源；需要统一关联模型。WebSocket/custom通常只有call级精度；deferred和原生内部transport retry等未形成完整观测保证。provider终结协议也包含本地兼容政策，不应提高为已验证的上游契约。

## 5. 既有适配器契约还缺什么

前一轮核心与InputQueue参考可以继续沿用，但**不能认为通用SDK已冻结**。本次全面清单新增或明确了以下工作：

1. **注册/准入**：runtime版本、契约版本、capability revision、解释器与存档codec注册、场景门槛和结构化unsupported。
2. **事件与结果联合**：message/tool/retry/context/persistence/close的中性DTO；背压、gap和关闭水位；缺phase/token时诚实表达。
3. **工具桥及交互**：完整descriptor/result而非当前裁剪DTO；调用权限和unknown；人类问答不能沿用原生fallback值。
4. **四类原生扩展完整DTO**：history/branch/context/recovery要覆盖原生语义、安全点、单写者、CAS及补偿，不能只有方法名。
5. **资源配置面独立契约**：发现与安装分离、提示词组合、preview/runtime、扩展/MCP lifecycle、设置原生codec和版本补丁封装。
6. **ModelGateway完整边界**：stream/complete、可选deferred、凭据/provider桥、失败/重试安全、协议与价格测量；不把宿主OAuth UI和quota纳入AgentRuntime。
7. **账务修订协议**：统一request/attempt/source关联，unknown/partial/measured与定价provenance，取消后同ID修订、去重、未决结算保留。
8. **离线及场景契约验证**：模块依赖倒置、FakeAdapter、损坏/缺失能力、断线/强杀/迟到回调等验收；本轮未实现或执行这些测试。

## 6. 按场景准入，不按runtime名字特判

| 场景 | 最小要求 | 不满足时 |
| --- | --- | --- |
| 浏览旧原生档 | 对应格式的只读ArchiveReader、scope/物理身份验证、投影完整性声明 | 明确缺适配器/格式不兼容/损坏；不启动agent、迁移或建空档 |
| 记忆/标题单次推理 | ModelGateway + 宿主作业许可、deadline、无工具结果校验及费用归属 | 独立失败，不要求创建完整agent会话 |
| 受限新委派任务 | 核心生命周期、宿主工具桥、执行身份/预算/停止回收、可恢复结果和事件/费用完整性声明 | 不接管Tasks事实源；能力未证明前不准入 |
| 新聊天基础能力 | 输入/事件/原生持久与恢复、安全工具、停止、所选模型桥及上下文安全策略 | 不可把缺失保存/取消能力伪装成完整聊天 |
| 排队撤回、分支重写、热重载、手动压缩等 | 分别具备queue/branch/configuration/context能力与revision | UI禁用并返回结构化unsupported；不得空成功或静默换runtime |
| 现有Pi完整行为对等 | 覆盖当前适用能力及宿主语义，包含故障与迟到结算 | 不宣称已替换Pi；先保留Pi会话运行路径 |

DSH仍沿用[固定版本研究](pluggable-agent-runtime-research.md)的结论：SDK/ACP能力不等价，宿主工具桥、停止/drain、原生存档/上下文、provider和解释器均需独立证明。本次没有新增DSH运行证据，不将其标为可直接替换。

## 7. 验证、限制与下一阶段验收

### 本轮已验证

- AST统计器实际运行成功；独立文本扫描核对94文件/127字面量锚点/277bindings/100symbols，独立重算153文件语法闭包和源码SHA，验证生成缓存未混入。
- 151项数据的ID/字段/状态/主责/来源路径、分组求和、全部94直接依赖文件的分类映射；可重复渲染完整矩阵和附录。
- 语义盘点以源码为证据，区分live/partial/helper/gap/new；最终报告另经独立审阅和文档静态检查，检查范围见复现说明。

### 本轮没有验证

- 不运行npm test、check、build、FakeAdapter或真实模型/DSH；不验证供应商实时价格、权限、token/cost质量、性能和取消延迟。
- 仓库中存在测试不等于本轮通过。静态盘点顶层tests有635文件（398 `.test.ts`、1 `.test.mjs`、194 `.check.ts`、2 `.check.mjs`、40其他），默认npm test不直接覆盖全部check；命名live/SDK/integration也不证明真实远端请求。
- 语法图未穷尽import-type/require/别名/反射/计算路径/外部资源；600文件解析成功不等于类型检查。8处私有路径是有限识别，不穷尽所有私有属性/hook。
- 94/94是**分类映射覆盖**，不是完整行为覆盖、接口正确性证明或测试覆盖率。151项是审计分类，不是所有潜在未来功能的封闭集合。

### 后续如授权实施，应按这些结果验收

1. 上层、shared、contract不导入Pi/DSH类型或原生对象；唯一可信组合层选择实现，provider/资源/存档依赖各自收口。
2. 用Pi先做完整纵向适配，现有停止强度、任务事实源、授权、历史/压缩/恢复和费用未知语义不降级。
3. 用FakeAdapter证明宿主没有偷取Pi对象、调用未声明能力或绕过唯一执行池，并覆盖拒绝/超时/未知交付/部分初始化清理。
4. 以离线fixture验证原生格式/分支/工具配对/压缩冲突、队列竞争、事件gap/背压、强杀及迟到usage修订。
5. 第二runtime先通过受限场景准入，具备证据后再开放主聊天；不做现有会话无损热切换。

**本轮止于研究交付；以上实施、迁移、产品测试或部署均需新的授权。**
