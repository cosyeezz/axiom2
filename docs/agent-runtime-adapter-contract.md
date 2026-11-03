# Axiom 通用 Agent Runtime 适配器契约

> 状态：接口设计提案，未接入产品代码。目标是让 Axiom 上层调用自己的稳定契约，由 Pi、DSH 或其他 adapter 实现。不是把所有 SDK API 改名，也不是本轮已完成运行时替换。
>
> 全量源码统计与能力范围：[全面能力盘点](agent-runtime-capability-inventory.md)（151项审计分类，不是151个核心方法）；完整矩阵明确当前链路、部分支持、构件与缺口。
>
> 事实依据：[可替换运行时调研](pluggable-agent-runtime-research.md)。本轮映射在 HEAD 为 `da7c037fa0157a74a750ec044d165c73ca751b58` 的脏工作树中抽查；HEAD不覆盖全部被审计字节，逐文件manifest及非原子快照限制见全面能力盘点；设计文档中的新目录和类型均为建议，不代表已存在。候选运行时沿用前文固定版本证据，未安装或执行。

## 1. 核心决策

**可以按“上层业务 → Axiom 自有接口 → 适配器 → 底层实现”组织。** 接口的所有权在 Axiom，不在 Pi、DSH、ACP 或 MCP；它们分别是实现或传输选项。

```text
UI / HTTP / WebSocket / Tasks / 记忆 / 费用
                     │ 只见 Axiom DTO
          AgentService / HistoryService
                     │
       RuntimeRegistry + 现有 ExecutionPool
                     │
       宿主控制 worker / 中性 IPC 契约
               ┌─────┴────────────┐
            PiAdapter          DshAdapter
          Pi SDK / 原生工具   ACP 或 SDK + 可信 bridge
               │                  │
           Pi 原生存档         DSH 原生存档

宿主向适配器提供：ToolGateway / 事件接收 / 授权与配置引用
模型控制面独立：ModelGateway（可以暂时保留 pi-ai 实现）
```

依赖方向必须是：业务依赖 contract，adapter 实现 contract；不能让 contract 反向 import adapter，或让业务直接取得 `AgentSession`、Cordis Context、原生 session manager。

第一版用内置白名单注册即可，**不要求动态下载安装插件、任意路径加载或活会话热替换**。可信适配器也不等于安全沙箱。

## 2. 职责分配

| Axiom 保留 | 适配器负责 | 不应强行统一 |
| --- | --- | --- |
| 工作区授权、宿主会话与 run 身份、任务及结果事实源、记忆业务 | native agent loop、SDK/协议控制、厂商事件转换 | 原生上下文结构、provider 签名、重试细节 |
| 唯一执行池、容量、lease/generation、执行许可、回收判断 | 启动需求、环境准备、原生工具包装、实际停止和 flush | Pi entry/tree 与 DSH SessionEvent 物理格式 |
| 业务工具执行与副作用校验、工具结果访问权限 | 将宿主工具 schema/result 映射到底层工具协议 | 不存在的 phase、请求级 usage、token 流 |
| 历史显示索引、费用账本、交付去重、通知、UI 能力门禁 | 原生存档读取/恢复/分支/压缩及其不透明游标 | 不同 runtime 的无损热切换 |
| 模型选择意图、凭据授权与配置版本、产品策略 | 对该选择的底层解析与安全应用 | 各 runtime 必须支持所有 provider/OAuth |

标题、记忆整理等独立模型作业继续走自己的作业/ModelGateway 边界，不强迫变成完整 agent session；也不再建立另一套执行池。runtime 选择与 provider/model 选择是两个维度。

## 3. 最小核心接口

下面是一份自包含的 TypeScript **类型参考**，只描述契约，不包含进程启动或 SDK 实现。扩展操作见下一节，不把所有可选能力塞进核心接口。

```ts
type Json = null | boolean | number | string | readonly Json[]
  | { readonly [key: string]: Json };
type RuntimeId = string;
type InputMode = "prompt" | "follow-up" | "steer" | "continue";
type Content =
  | { kind: "text"; text: string }
  | { kind: "attachment"; attachmentId: string; mediaType: string };

interface SessionScope {
  workspaceId: string;
  sessionId: string;
}
interface RunIdentity extends SessionScope {
  runId: string;
  lease: { instanceId: string; generation: number; leaseId: string };
}
interface NativeSessionRef {
  runtimeId: RuntimeId;
  storeId: string;       // 宿主登记的存储域，不接受客户端任意文件路径
  nativeSessionId: string;
  nativeFormat: string;
}
interface ModelChoice {
  provider: string;
  model: string;
  reasoning?: string;   // 不假定所有 runtime 共享 Pi thinking 枚举
  configurationRef: string; // 只传授权配置引用，不把密钥写入会话元数据
}
interface HostTool {
  name: string;
  description: string;
  inputSchema: Json;
  effect: "read" | "write" | "external";
}
interface HostSessionSpec {
  scope: SessionScope;
  cwd: string;
  role: "main" | "task";
  policyRevision: string;
  instructionRef: string;
  resourceRefs: readonly string[];
  tools: readonly HostTool[];
  model: ModelChoice;
  mode: { kind: "new" } | { kind: "resume"; ref: NativeSessionRef };
}
interface RuntimeCapabilities {
  textOutput: "delta-and-committed" | "committed-only";
  inputModes: readonly InputMode[];
  inputIdentity: "deduplicated" | "queryable" | "unobservable";
  nativeRecovery: boolean;
  hostTools: "callback" | "bridge" | "none";
  usage: "request" | "activity" | "unavailable";
  nativeDurability: "flush-barrier" | "close-only" | "unobservable";
  extensions: readonly string[]; // 核心外能力的版本化名称，不是任意方法名
}
interface RuntimePlan {
  runtimeId: RuntimeId;
  adapterVersion: string;
  runtimeVersion: string;
  contractVersion: 1;
  profileHash: string;
  workerEntryRef: string;
  interpreterRef: string;
  configurationRef: string;
  reuse: "single-use" | "same-session";
  policyEvidenceRef: string;
}
interface ExecutionPermit {
  identity: RunIdentity;
  profileHash: string;
  permitId: string; // 协调器签发，worker 校验；不是调用者自报的 allowed=true
}
interface HostInput {
  inputId: string;
  mode: InputMode;
  source: "user" | "task-notice" | "host-continuation";
  content: readonly Content[];
}
interface InputReceipt {
  inputId: string;
  nativeMessageId?: string;
  admission: "accepted";
  persistence: "confirmed" | "pending" | "unknown";
}
interface NativeDurability {
  state: "confirmed" | "unknown" | "failed";
  through?: string; // 适配器可解释的原生持久化水位
}
interface RunClosure {
  identity: RunIdentity;
  quiescent: true;  // 只在真正停稳后返回；超时/无法确认应失败并隔离
  durability: NativeDurability;
  reuse: "eligible" | "forbidden";
  finalEventSeq: number;
}
interface CloseReceipt {
  identity: RunIdentity;
  closed: true;
  quiescent: true;
  durability: NativeDurability;
  finalEventSeq: number;
}
interface InitializationFailure {
  code: "INITIALIZATION_FAILED" | "CLEANUP_UNCONFIRMED";
  identity: RunIdentity;
  cleanup: "confirmed" | "unconfirmed";
  durability: NativeDurability;
  finalEventSeq: number; // 初始化事件已观察水位；gap 时不是完整屏障
  events: "drained" | "gap";
  message: string;       // 脱敏说明，不是原生异常对象
}
interface RuntimeEvent {
  contractVersion: 1;
  identity: RunIdentity;
  eventId: string;
  seq: number; // 当前绑定内递增，不等于原生日志 seq
  occurredAt: string;
  kind: string; // 完整实现应改为第 6 节各事件的判别联合
  payload: Json;
  causation: { inputIds: readonly string[]; certainty: "exact" | "activity" | "unknown" };
}
interface ToolInvocation {
  identity: RunIdentity;
  invocationId: string;
  nativeCallId?: string;
  name: string;
  arguments: Json;
}
interface ToolResult {
  status: "ok" | "error" | "cancelled" | "outcome-unknown";
  modelContent: readonly Content[];
  detailsRef?: string; // 宿主侧详情，不直接进入模型上下文
}
interface HostPorts {
  emit(event: RuntimeEvent): Promise<void>; // resolve = 宿主接纳，不是原生刷盘
  invokeTool(call: ToolInvocation, signal: AbortSignal): Promise<ToolResult>;
}
interface RuntimeRun {
  readonly identity: RunIdentity;
  submit(input: HostInput): Promise<InputReceipt>;
  finish(options: { deadlineAt: number }): Promise<RunClosure>;
  stop(options: { reason: string; deadlineAt: number }): Promise<RunClosure>;
}
interface RuntimeBinding {
  readonly nativeRef: NativeSessionRef;
  readonly capabilities: RuntimeCapabilities;
  begin(permit: ExecutionPermit): Promise<RuntimeRun>;
  close(options: { deadlineAt: number }): Promise<CloseReceipt>;
}
interface AgentRuntimeAdapter {
  readonly descriptor: {
    id: RuntimeId;
    adapterVersion: string;
    contractVersion: 1;
  };
  prepare(spec: HostSessionSpec, signal: AbortSignal): Promise<RuntimePlan>;
  bind(plan: RuntimePlan, spec: HostSessionSpec, identity: RunIdentity,
       ports: HostPorts, signal: AbortSignal): Promise<RuntimeBinding>;
}
```

### 接口为什么这样拆

- `prepare` 负责可核验环境计划；不允许模型请求、原生工具执行或未经许可的自主后台任务。允许在授权数据域内准备本地配置，不能将它伪装成纯读预览。
- 宿主根据 plan，通过**原有池**创建/复用控制 worker；`bind` 先取得当前 RunIdentity、安装事件/工具端口，再打开原生会话，覆盖初始化阶段并报告失败前已发生的事实。初始化状态属于宿主绑定，不等于已经进入可执行 run；一旦发现越权执行，拒绝准入并清理。宿主业务拿到的是中性代理句柄，不是 adapter 内存对象。
- `RuntimePlan` 是对现有 `PreparedEnvironment` 的设计输入，不是可原样替换的现成类型。Pi 的 models 文件、`.pi`、SDK 版本等只进入 Pi profile；launch、环境变量与秘密在可信组合层解析，不在 UI/普通业务层展开。
- **一个 RuntimeBinding 只对应一个 RunIdentity 和至多一个 RuntimeRun。** bind 捕获的身份不可更换；begin 首次接受后，同一 permit 的重复调用返回同一个 Promise/句柄，不创建第二次执行。不同 permit/身份拒绝；终态句柄拒绝 submit，close 后拒绝 begin。新 run 必须重新 bind，即使底层复用了同一个 worker/native session，也不能复用旧 binding/回调。
- `begin` 必须验证真实 permit 与 profile、lease、run 的对应关系，且只开放当前 run 的执行权。恢复 native session 也不能在 permit 前自动继续工作；如果底层一启动就可能请求模型，必须先阻断该行为，否则不能接纳该配置。
- `submit` 只承诺已接纳，不承诺模型已经消费、执行完成或刷盘。模式与活动状态也要验证：prompt 不自动等于忙碌时追加，follow-up 与 steer 不能互换；continue 的恢复准备和实际续接分开。超时是“投递状态未知”，不是“未投递”；只有具备去重或可证实查询时才能重试。
- `finish` 关闭本 run 的新输入准入，并等待已有活动、宿主工具、事件交付及已声明的持久化屏障；不是简单等到最后一段文本或某个 idle 通知。
- `stop` 请求终止并达到同样的停稳屏障。它是**所有可接纳适配器必须实现的宿主级语义**，底层可通过原生取消、关闭独占会话或回收独占进程实现。粗取消不冒充软中断，也不能伤及其他绑定。
- `finish/stop` 需要共享一次终态协调：重复调用幂等，stop 可以升级正在进行的 finish。终止、事件 drain、后代清理、原生 flush、宿主交付分别可观测；清理失败不能返回 `quiescent: true`。
- `close`、finish、stop 使用同一个终态协调器。close 先封闭准入；若 run 活跃，委托 stop 达到停稳；若从未 begin（例如 permit 被拒），同样排空初始化活动/事件、后代和原生持久化，再返回带 identity、quiescent 与 finalEventSeq 的关闭回执。关闭期间仅允许原身份的终态/结算事件进入端口；普通执行事件在最终水位后不得继续进入，迟到费用只走对账路径。
- close 释放当前绑定，不代表关闭整个共享 runtime，也不代表进程已退出。池仍须确认控制 worker、其子进程/后代与残留活动都满足回收条件；超时则隔离或强制回收，不把 worker 放回可复用池。
- “已停稳”与“原生尾部已保存”是两件事。强杀可以阻断活动，但 durability 只能记 unknown/failed，不能补造成功。原生若只有 close 才提供持久屏障，finish/stop 必须先完成相应原生关闭才能记 confirmed；否则保留 unknown，由之后 close 回执对账，不能提前把保存判为成功。`reuse: eligible` 也只是候选资格，仍须通过宿主清理和配置漂移检查。
- bind 若在返回句柄前失败，由 adapter 在拒绝 Promise 前封闭准入并尝试清理已创建资源、排空已发初始化事件，以 InitializationFailure 报身份/水位/持久性/清理状态；宿主始终拥有外层控制进程与子树的回收责任。无法确认清理或事件交付时标记 unconfirmed/gap 并 retire，不能因为没有 RuntimeRun 或 bind 抛错就直接释放到可复用池。begin 失败但已有 binding 时，宿主仍必须调用 close。

## 4. 可选能力是扩展端口，不是空实现

最小核心不塞入 Pi 全部 API。下列端口以**语义名称 + 契约版本**注册，并在绑定完成后返回有效能力；运行时版本、profile、工具桥、模型或策略变化后重新计算。

| 扩展 | 契约应表达什么 | 不允许的替代 |
| --- | --- | --- |
| `input-queue.v1` | 查询每个 input 的 queued/consumed/recalled/unknown 与证据；按 ID 撤回且与消费竞争有确定结果 | 超时后盲目重发；从显示文字猜已消费 |
| `interruption.v1` | 软中断与可继续性；是否保留队列、工具、会话；实际停止水位 | 把强杀进程说成可继续的 interrupt |
| `interaction.v1` | 审批/问题响应的 interactionId、宿主响应、期限、取消与单次结算 | 把问答响应改成一条普通 prompt；等待无人能回答的问题 |
| `configuration.v1` | 模型/推理、资源和工具集合更新的 revision、接纳、实际生效安全点；请求固定实际选择 | 选择操作联网试模型、静默回退、只改 UI 或摘要阶段仍保留工作工具 |
| `native-history.v1` | 分页原生投影、稳定游标、当前分支、完整性与快照版本、只读附件定位 | 把本次连接事件缓存当完整历史 |
| `native-branch.v1` | fork/rewrite 的稳定原生锚点、源版本前置条件、源分支不变、新归属 | 用复制可见文字冒充 native fork |
| `native-context.v1` | 压缩准备/提交、快照前置条件、工具配对、持久幂等标记、上下文水位 | 把 Pi compaction 产物塞进 DSH；成功标志只存在内存 |
| `native-recovery.v1` | 原生 resume/修复、归属/格式/单写者检查、缺失工具结果的未知态 | 恢复失败后创建空会话或重放副作用 |

这些名称是本提案，不是现有命令。实施时各端口使用判别联合定义请求/结果，不提供 `call(method: string, any): any` 的万能逃生口。活动控制端口绑定当前 RuntimeBinding；原生历史/分支等离线端口由独立 archive registry 解析，不为读历史而启动 agent。这里仅完整列出核心类型，其余端口按表进一步定义；例如输入端口可采用下列强类型形状：

```ts
interface InputState {
  inputId: string;
  state: "queued" | "consumed" | "recalled" | "unknown";
  evidence: "native-memory" | "native-durable" | "host-only" | "none";
}
interface InputQueuePort {
  inspect(inputIds: readonly string[]): Promise<readonly InputState[]>;
  recall(inputIds: readonly string[]): Promise<readonly InputState[]>;
}
interface RuntimeExtensionMap {
  "input-queue.v1": InputQueuePort;
  // 其余扩展各自增加明确类型，不用 unknown/any 兜底
}
interface RuntimeExtensionResolver {
  get<K extends keyof RuntimeExtensionMap>(binding: RuntimeBinding,
    name: K): RuntimeExtensionMap[K] | undefined;
}
```

端口调用也必须携带或在绑定时捕获宿主身份和前置版本，并服从当前授权/lease/许可；涉及额外模型请求的压缩等操作，要单独由宿主作业准入，而不是从历史读取接口隐式触发。

`nativeRecovery: true` 必须与 `native-recovery.v1` 的实际注册及版本兼容对应，并证明 bind 的 resume 模式可用；能力报告不能只写布尔值却缺少实现。其他扩展声明也须在注册/绑定时核验，能力失效后不能继续沿用旧 UI 许可。

主/子任务角色与预算、工作→摘要阶段仍由宿主管理；适配器应用工具集合及阶段策略时返回实际生效 revision。阶段更新不是单纯替换工具列表：应携带期望旧 revision、新阶段/预算/工具策略，并在安全点协调暂停或终止当前阶段、保存队列、阶段指令及追加恢复的顺序。宿主仅在收到实际应用回执后推进阶段；部分失败标记 unknown 并停止/恢复校验，不假定底层支持事务回滚。子任务冻结 package/扩展、禁止递归委派、阶段结束撤工具等限制必须保留。若某底层不能在安全点收紧工具权限，宿主就不能将它接入要求该语义的任务场景，不能只追加一段提示词冒充限制。

Axiom 的统一服务门面负责能力校验与路由。业务可以按 `native-branch.v1` 判断入口是否可用，但不写 `if (runtimeId === "pi")`。不支持时返回结构化 `UNSUPPORTED_CAPABILITY`；不会提供返回成功的空方法。其他标准错误至少区分 STALE_BINDING、PERMIT_DENIED、REVISION_CONFLICT、DELIVERY_UNKNOWN、PERSISTENCE_FAILED、CLEANUP_UNCONFIRMED；传输只暴露脱敏说明、原身份和是否可安全重试，不透传 SDK 异常或带秘密的配置。

**能力之外还有准入策略。** 例如“可运行受限分析任务”不等于“可替换主聊天”。如果场景必须具备记忆桥、历史恢复、硬预算或实时流，而候选缺失，应拒绝该场景或明确标为不可用，不能用关闭按钮宣称完整替换已通过。

## 5. 启动、复用与停止状态机

```text
prepare → pool.acquire → bind（事件端口已就绪，不能执行）
    → binding_ready → 宿主重新核验 → execution_permit
    → begin → submit → active
    → finish 或 stop → 关闭输入准入 → drain / flush
    → 宿主确认关闭/交付与 cleanup → release lease

任一步失败 → 明确失败/未知状态 → 清理或隔离 → 不盲目复用
```

这里复用的是池中的进程/环境，不是把旧 `RuntimeRun` 改个 runId 重用。回调在入口捕获原 lease/run；迟到结果不能被新绑定重新标号。事件接收与转发在 bind 时安装，begin 前若发生执行必须报协议违约；不丢弃后当作没有发生。

同一会话只允许一个原生写者；fork、rewrite、压缩应用、资源 reload 需要宿主串行化和底层安全点。当前 Axiom 用户 stop 是由执行池 retire worker/process tree，不只是 Pi abort；首个 Pi 适配器应保留此行为，不能借统一接口擅自改成软取消。`stop` 还要阻断随后到达的任务通知或后代消息启动新活动。DSH ACP `cancel` 只能完成其有限取消语义，宿主终止应映射到 close；SDK 若只支持 shutdown，应独占进程或补可信 bridge，不能取消共享进程内别人的会话。

`finish` 如无法可靠封闭自主活动，应关闭会话/独占 runtime 后再结算，而不是继续保温。预热只建立环境，禁止加载会自行推理的 profile。资源预算、超时和回收统计覆盖完整进程树；DSH 的 Node 版本由受审计 interpreter 计划解决，不靠 `dshBin` 冒充 Node 选择。

## 6. 事件、工具和费用契约

### 6.1 事件分类与可靠性

核心代码为简化用了 `kind/payload`；实施时至少定义下列判别联合，不允许原生 JSON 任意穿透业务/UI。

| 事件族 | 要点 |
| --- | --- |
| `input.state` | inputId、接纳/原生消费/撤回/未知；持久化证据单列 |
| `message.delta` / `message.committed` | 宿主稳定 messageId、可用的原生锚点；delta 不重复累加到最终消息 |
| `tool.state` | invocationId、started/progress/finished/outcome-unknown；工具结果与业务任务完成分开 |
| `request.state` / `usage.reported` | 实际路由、原生 requestId 或明确 activity 粒度、usage 的来源与修订 |
| `interaction.required` | 审批/用户问题的 interactionId、期限、取消与专用响应端口；不是伪装用户 prompt |
| `configuration.applied` / `context.changed` | 实际生效 revision、原生上下文水位；不输出敏感配置 |
| `run.state` / `diagnostic` | 生命周期、重试/原生错误的安全摘要；不把文本结束当任务结束 |

约束：

1. 宿主事件日志只接纳有效身份；`seq` 为**每个绑定**的序号，`eventId` 支持重复交付去重，不要求底层提供同样机制。
2. emit 的 Promise 应用于背压/有限缓冲；关键事件不能静默丢弃。底层监听器不能 await 时，由适配器提供有界队列或可信桥；溢出应暂停/失败/标记 gap。丢失 token 可触发 committed 快照纠正，丢失关键结算则不能无证实补造。
3. 宿主事件落库只证明宿主已看到，并不证明 native flush；UI 显示、native durability、业务结果交付分别记账。
4. 原生关联不足时因果关系为 activity/unknown。不能把“活动区间最后助手文本”强行绑定某条 input 或 task；Tasks 仍保存精确 taskId/resultId 并先存后通知。
5. `finalEventSeq` 是普通执行事件的关闭水位。关闭后原 lease 的消息不再改变新 run；迟到用量通过独立校验的对账路径入原账本，不重新激活会话，也不算成新 run 的消耗。
6. 宿主 WebSocket 重连回放自己的事件/投影，不假定 DSH 重新订阅会重放旧事件。完整历史恢复另走 native-history 端口；不完整投影必须标记范围和缺口。
7. 区分原生 phase、宿主推断的显示交付和 unknown。当前 Pi 显示层确有 `stop → final_answer` 兼容推断，不能称为原生确证；保留显示行为不等于把推断伪装成底层事实。

### 6.2 工具是宿主反向端口

Axiom 定义业务工具并执行，adapter 只包装底层工具协议。`HostPorts.invokeTool` 是进程内表述，跨进程时转成受控 IPC/MCP/可信桥；AbortSignal 不能原样序列化，应转 cancel 消息并等待结算。

宿主重新检查工具名称、参数 schema、工作区/任务归属、run/lease、权限和预算；工具 effect 字段只是声明，不是安全边界。调用采用稳定 invocationId 和宿主持久状态，重复调用不能重复产生副作用；对于非幂等工具在不确定崩溃窗口返回 outcome-unknown，不能承诺跨进程 exactly-once 或自动重试。

`modelContent` 与宿主详情分离，适配器只把前者送入模型。工具 schema 可以由 TypeBox 等生成 JSON Schema，但 contract 不依赖 Pi `defineTool`、Pi content/details 或 DSH canonical output 类型。附件使用宿主受控引用，不能把任意本地路径/API 密钥塞进模型结果。

内置 shell、文件和原生委派也必须满足同一策略：要么由宿主管理，要么 profile 有可核验等价限制。不能只桥接 memory 工具，却留一个不受控 shell 绕过记忆权限；不能允许 DSH 另建递归委派、调度、标题或自动请求体系绕开 Axiom。

### 6.3 费用与模型不混成一层

- ModelGateway 消费宿主已授权并发布的模型选择与凭据引用，负责原生凭据解析及provider协议适配；授权政策、凭据发放和配置发布仍归宿主，runtime adapter负责可信的agent模型桥。ModelChoice 不是 Pi Model，unsupported provider 也不会自动变兼容。
- 记录逻辑选择与请求实际 provider/model 两者，不能把变更后的选择反写旧请求。模型选择本身不探测模型，不因 advisory availability 静默回退；配置失败归属于后续实际请求。
- usage 必须标明 request/activity 粒度和 source/revision。input/output/cache tokens、provider cost、宿主估价各自可未知；不把 context occupancy 当账单、不把未知记零，也不重复累加摘要或重放投影。
- 价格和 usage 来源留在宿主唯一账本。请求失败、取消和强杀都可能收费；后台压缩等独立请求也须可归属。
- 模型调用可暂时由 Pi 或 DSH adapter 各自完成，不要求第一步搭建统一网络代理。若产品需要硬请求预算而候选无法观测/限制，则该配置不满足准入，而非宣布预算已执行。

## 7. 原生存档与宿主投影

宿主会话记录增加 runtimeId、adapter/contract 版本、nativeRef、profile/policy revision；旧记录缺 runtimeId 时显式映射到历史 Pi。敏感配置与原生路径不发给 UI，客户端只能提交宿主 session/message 引用。

- **原生存档**由 adapter 解释，是恢复底层上下文的依据；没有把所有 runtime 转为一份“通用 prompt 数组”的要求。
- **宿主投影**用于 UI、搜索、费用关联和交付记录；不能反向当成完整原生上下文。显示快照丢失时可重建，但必须保留稳定身份与版本边界。
- **原生操作端口**隔离 Pi SessionManager、分支树和压缩 entry；归属/物理路径校验由宿主与 adapter 两层执行，不能只信 nativeRef 文本。
- 新会话可选 runtime；同 runtime 原生 fork 与跨 runtime 显式交接是两个操作。跨 runtime 交接新建会话、保留来源与损失说明，不称无损 native fork。
- adapter 缺失或不兼容时会话进入明确 unavailable 状态，不能静默换底层并新建空存档。回退只适用于未创建绑定且用户可见的新会话选择；恢复已有会话禁止自动改 runtime。

## 8. 建议的代码组织与调用迁移

建议目录（**尚未创建业务模块**）：

```text
server/runtime/
  contract/          中性 DTO、事件联合、能力及错误
  registry.ts        白名单注册、契约/版本兼容与场景准入
  service.ts         上层统一门面、生命周期与历史路由
  worker-host.ts     中性 IPC、lease、permit、工具桥与回收
  adapters/
    pi/              Pi worker、profile、工具包装、原生 repository
    dsh/             DSH launcher、协议/bridge、原生 repository
```

具体是否拆包可后定，不先制造庞大的插件平台。`ExecutionPool`、`Tasks`、费用、记忆的现有业务对象不搬进 adapters。

| 当前入口/模块 | 迁移后依赖 | Pi 专有部分放哪里 |
| --- | --- | --- |
| [agents.ts](../app/src/server/agents.ts) 的 prompt/resume/model/stop | RuntimeService + 场景准入 + 宿主既有事务/命令串行化 | 不再直接取 SessionManager 或发 Pi 细节命令 |
| [agent-worker.ts](../app/src/server/agent-worker.ts) | 中性 worker-host、RuntimeRun、HostPorts | createAgentSession、原生队列、安全点 hook、事件转换留 Pi adapter |
| [execution-profile.ts](../app/src/server/execution-profile.ts) | 中性 plan/profile 及宿主漂移验证 | `.pi`、SDK 版本、models 格式、Pi 资源快照留 Pi profile |
| [axiom-prompt.ts](../app/src/server/axiom-prompt.ts) | 宿主 instruction/resource 输入 | 私有 Pi prompt hook 封在 Pi adapter，不扩散到 contract |
| [task-tools.ts](../app/src/server/task-tools.ts)、[memory-tool.ts](../app/src/server/memory-tool.ts) | 中性 HostTool + ToolGateway | defineTool 与结果包装由 Pi adapter 处理，业务执行不迁走 |
| [agents/native-queue.ts](../app/src/server/agents/native-queue.ts)、[agents/persisted-inputs.ts](../app/src/server/agents/persisted-inputs.ts) | input-queue / 原生持久证据端口 | Pi 队列和落盘解析不再由 Tasks 直接理解 |
| [session-reloads.ts](../app/src/server/session-reloads.ts)、[session-safe-point.ts](../app/src/server/session-safe-point.ts) | configuration / interruption 扩展 + 宿主串行化 | Pi boundary、模型应用、skills/full reload 顺序留适配层 |
| [transcript.ts](../app/src/server/transcript.ts)、[agents/views.ts](../app/src/server/agents/views.ts) | HistoryService 与统一只读投影 | Pi 文件读取、entry/tree 映射留原生 repository |
| [session-fork.ts](../app/src/server/session-fork.ts)、[session-rewrite.ts](../app/src/server/session-rewrite.ts) | native-branch 扩展；宿主仍管会话创建、授权与空闲校验 | 原生锚点、clone/fork、保留分支逻辑留 Pi adapter |
| [compressions.ts](../app/src/server/compressions.ts)、[compression-context.ts](../app/src/server/compression-context.ts) | 宿主压缩作业控制 + native-context 扩展 | Pi 快照/entry 工具配对/幂等应用留 Pi adapter；调度与归属不搬走 |
| [request-usage.ts](../app/src/server/request-usage.ts)、[costs.ts](../app/src/server/costs.ts) | 中性 request/usage 投影和唯一账本 | Pi usage 解析留 adapter，价格和去重属于宿主 |
| [tasks/scheduler.ts](../app/src/server/tasks/scheduler.ts) | 继续走同一 RuntimeService/池、输入回执及任务结果存储 | 不认识 Pi AgentSession；不改为 DSH 原生子代理调度 |

## 9. 实施顺序与验收

### A. 接口落地，只封装 Pi

先增加中性 contract 和 Pi adapter，通过统一门面迁移一个完整纵向路径：创建/恢复 → 许可 → 提交 → 工具 → 事件/费用 → 停稳/持久化。已有会话仍用原格式；先不改 UI 交互和默认行为。

不能只在 createAgentSession 外包一层后宣称完成。继续迁移 history、队列回执、fork/rewrite、模型安全点、reload、压缩；否则上层仍依赖 Pi 的存档和语义。

### B. 验证上层确实不依赖 Pi

使用不依赖 Pi 的 FakeAdapter，跑相同宿主契约 fixture：正常、延迟/重复事件、投递超时、拒绝许可、部分工具结果、停止中迟到消息、尾部未刷盘、进程崩溃。FakeAdapter 用于证明边界，不证明 DSH 已具备实现能力。

依赖门禁按职责区分：runtime 业务层不能 import `@earendil-works/pi-*` 或具体 adapter；composition root 可以注册实现，ModelGateway 实现可以暂留 pi-ai。不能因为还保留模型网关，就允许会话业务继续拿 Pi session。

### C. 接第二个适配器，再开放场景

固定 DSH 版本与 Node 环境，先实现受限子任务场景。ACP/SDK 只是适配器内部传输；每个组合如实报告能力和策略证据，不把其不足藏到通用接口下面。逐项满足主会话需要后才开放默认/可选主聊天。

最低验收：

- **依赖倒置**：上层只编译依赖 contract；FakeAdapter 可替换 Pi 跑完整主/子任务路径。
- **行为回归**：Pi 固定 native fixture 的恢复、历史、队列、分支、rewrite、reload、模型选择、费用和压缩不变。
- **许可隔离**：无 permit/过期 lease/配置漂移拒绝执行；bind、预热、历史读取不调用模型；迟到消息不污染新 run。
- **可靠交付**：接纳≠消费≠native flush≠宿主结果交付；未知投递和未知工具副作用不盲重试；停止/flush 失败不复用。
- **事件可靠性**：背压、gap、重复、重连、无 token 流、部分历史都能明确呈现；最终文本不替代任务结果身份。
- **安全与费用**：工具和原生 shell 无旁路，子任务限制不变；取消可收费、未知不为零；所有进程/后代都纳入清理。
- **存档独立**：旧 Pi 兼容、缺 adapter 明确失败、跨 runtime 只能显式交接；每个原生上下文提交只有一个获授权写者/协调器；Axiom异步压缩与原生安全网可并存，但触发策略必须串行提交并复验上下文版本和冲突。

本轮仅整理接口与迁移设计，并做文档/类型参考的静态核验；不表示上述产品回归、FakeAdapter 测试或 DSH 集成已经执行。真正接入、模型实测和部署属于后续实施范围。
