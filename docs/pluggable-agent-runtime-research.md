# Axiom 可替换 Agent Runtime 调研

## 1. 结论

**可以把 Pi 收敛成 Axiom 的一个底层运行时适配器，并接入 DeepSeek Harness（DSH）；但当前不是已有插件接口上加一个实现，而是一次涉及运行时、存档和投影边界的中等偏大型重构。**

建议让 **Axiom 做宿主，Pi / DSH 做可选 runtime**，而不是把整个 Axiom 搬进 DSH 的 Cordis 插件系统。保留 Axiom 的授权、记忆、执行池、任务交付、费用归属及 UI；runtime 负责自己的 agent loop 和原生会话语义。第一步是“可并存、按会话选择”，不是“同一个活会话任意无损热切换”。

- 如果只是使用 DeepSeek 模型，应继续在模型 provider 层接入，不需要换 harness。
- 如果要替换工具循环、上下文策略或使用另一套 harness 生态，runtime 插件化才有意义。
- **替换 Pi coding-agent 不等于清除全部 Pi 依赖。** 模型调用、认证、资源加载等仍可暂时使用 pi-ai / Pi SDK；是否完全移除是另一个范围更大的目标。
- DSH 可以做第二个适配器的验证对象，但其当前公开协议尚不足以提供 Axiom 现有功能的等价替换，不建议立即替换默认运行时。

## 2. 调研范围与版本

本轮为静态源码、文档和发布元数据核对；没有安装候选依赖、执行 DSH、调用模型、迁移数据或重启后台。

| 对象 | 本轮依据 |
| --- | --- |
| Axiom | `/Volumes/D_Work/axiom2` 当前工作树，基准 HEAD `44c3e52e6cf7f919842728d73a5aa7f16a45a7a5`；存在并行未提交修改，不代表已部署版本 |
| Pi | 当前应用实际解析到 `@earendil-works/pi-coding-agent` **1.1.0**；核对安装版 README、SDK 文档和 Axiom 集成 |
| DSH | 官方仓库 `deepseek-ai/deepseek-harness`，固定 commit **`22ddee3792402c3e70ec5f86a63c3e3e895a2f60`**，根包版本 **0.2.1-rc.3** |
| 发布 | 2026-10-26 查询 npm registry，确认 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-sdk-client` 的 0.2.1-rc.3 均已发布；不据此宣称源码快照与发布 tarball 已逐字一致 |

DSH 是官方开源 harness，不是仅提供 DeepSeek API 的客户端。官方 README 明确为开发者预览、未来会有破坏性变更；安全说明明确尚未接受安全审计，不得视为生产安全保证。主项目为 MIT，仍须核对分发时的第三方许可证。

## 3. Axiom 当前边界：哪些能留，哪些要拆

当前 `app/src/server` 有 **74 个文件引用 `@earendil-works/pi-*`**，包括类型引用和动态解析。这不是修改文件数估计，但说明 Pi 尚未被隔离在单一模块。

| 边界 | 当前事实 | 插件化建议 |
| --- | --- | --- |
| 资源调度 | [execution-pool.ts](../app/src/server/execution-pool.ts) 已有 lease、generation、容量、取消、执行许可与清理确认；不直接依赖 Pi，但使用 Node fork/IPC | 保留一个池；让 runtime 适配器提供环境及 worker 策略，不平行造 DSH 池 |
| 环境绑定 | [execution-profile.ts](../app/src/server/execution-profile.ts) 硬编码 Pi 包版本、`.pi` 配置、模型文件和 worker 路径 | runtime/profile/适配器版本进入绑定与复用身份；保留配置漂移检测 |
| 主／子执行 | [agent-worker.ts](../app/src/server/agent-worker.ts#L650) 创建 Pi settings、loader、扩展、原生工具、`createAgentSession` 并映射事件 | 先将现有实现完整封为 PiAdapter，再加入第二实现；不只包住一个工厂函数 |
| 提示词 | [axiom-prompt.ts](../app/src/server/axiom-prompt.ts#L10) 动态导入 Pi 内部 system-prompt，覆写私有 `_preparePromptAndToolLoadout` | 私有兼容桥留在 PiAdapter 内；抽象 Axiom 身份／记忆／工具策略输入，不要求其他 runtime 模仿 Pi 私有方法 |
| 业务工具 | [task-tools.ts](../app/src/server/task-tools.ts) 已通过 `call(name,id,params,signal)` 回调业务 | 抽出中性 schema、执行和结果契约；Pi `defineTool` 和 DSH `ctx.tools.register` 分别包装 |
| 存档与恢复 | [transcript.ts](../app/src/server/transcript.ts#L190)、[resume-session.ts](../app/src/server/resume-session.ts)、[session-fork.ts](../app/src/server/session-fork.ts) 直接使用 Pi manager、原生 entry/tree 与投影 | runtime 原生存档分开保存，宿主统一归属及显示投影；恢复缺失结果不重跑工具 |
| 压缩 | [compression-worker.ts](../app/src/server/compression-worker.ts)、[compression-context.ts](../app/src/server/compression-context.ts)、[compressions.ts](../app/src/server/compressions.ts) 使用 Pi 原生 compact，并校验快照、兼容尾部、工具配对、幂等落盘 | native compaction 是可选能力，启用须保留安全提交；Pi 压缩产物不能写入 DSH 存档 |
| 历史与费用 | [history-projection.ts](../app/src/server/history-projection.ts)、[costs.ts](../app/src/server/costs.ts)、[request-usage.ts](../app/src/server/request-usage.ts) 消费原生历史、阶段、usage、压缩关联 | 提供中性显示／用量投影，保留原始记录及未知值，不把“当前上下文”当全部历史 |
| 模型控制面 | [model-runtime.ts](../app/src/server/model-runtime.ts)、[model-service.ts](../app/src/server/model-service.ts) 包含 Pi ModelRuntime、认证、provider 和别名语义 | 与 AgentRuntime 分层；先保留已有模型网关，后续按必要性单独解耦 |

普通子代理也是 Axiom 通过 [tasks/scheduler.ts](../app/src/server/tasks/scheduler.ts) 启动的独立 agent 会话，不是 Pi 原生子代理。因此可保留 `delegate / append / cancel_task / read_result` 的宿主业务契约，再逐步支持由另一 runtime 执行子会话。不能同时启用第二套不受宿主约束的委派、预算和结果通知体系。

## 4. DSH 的实际接入能力与缺口

以下链接固定到本轮源码 commit，避免后续 master 更新改变证据。

### 4.1 架构与可组合性

[架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/architecture.zh.md) 将模型适配器、工具注册表、日志、agent loop 都作为 Cordis 插件，通过 profile、bundle 和 patch 组合。可构造 Axiom 专用组合，但 **DSH 内部插件化不自动等于 Axiom 已有外部 runtime 插件接口**。

[工具注册接口](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/tools/src/contracts.ts) 支持 JSON Schema、`execute(args, exec)`、取消信号、canonical output、模型内容 render 和展示 meta。其输出语义并不等同于 Pi 的 content/details，需要显式转换和隐私检查。

DSH 提供原生模型适配器，也有 [llm-pi-ai](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/llm/llm-pi-ai/package.json) 适配包（依赖 pi-ai ^1.3.0）。这表示模型传输层可复用，不表示 DSH 的默认 loop 或存档就是 Pi coding-agent 的同一实现。实验性子代理包另有 Pi coding-agent 依赖，也不能据此推为所有 DSH 路径都依赖该 runtime。

### 4.2 三种集成方式

| 方式 | 能力／证据 | 对 Axiom 的意义 |
| --- | --- | --- |
| TypeScript SDK + stdio JSON-RPC | [SDK 客户端](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/sdk/client/README.zh.md) 提供 `DeepSeekHarness` / `HarnessClient`，实际 spawn 同版本 dsh；支持 prompt、resume、事件通知、等待和审批 | 适合快速验证独立会话与原生事件；不是 Pi 式进程内 `createAgentSession` 替代品 |
| ACP 自动化协议 | [ACP 文档](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/acp/acp/README.zh.md) 提供逐会话 cancel/close、持久 resume/list、模型选择、MCP 工具和语义更新 | 更适合第一阶段受限子任务验证，也能复用给其他 ACP harness；但缺完整历史、原生呈现和细粒度观测 |
| Axiom 专用 DSH bridge 插件 | 利用 `ctx.tools`、`agent/*`、`session/event`、`agent/assistant-stream` 等扩展点；由受支持 launcher/profile 组合启动 | 完整体验的候选方向；需要自有协议、契约测试和版本维护，当前并没有现成桥 |

不建议默认把 Cordis/core 包直接散落导入 Axiom 主服务进程；当前 DSH 官方应用路径以具名 profile launcher 为中心，现成 TS SDK也是进程外控制。直接嵌入并非理论上不可能，但会让生命周期和升级耦合重新进入宿主。

### 4.3 不能忽略的协议差异

以 [SDK 协议类型](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/sdk/protocol/src/types.ts)、[服务实现](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/sdk/server/src/server.ts) 和 ACP 实现交叉核对：

1. **SDK 无逐会话取消／关闭。** 中止一次工作需关闭整个 runtime；若复用其进程承载多会话，会连带影响其他会话。首版若走 SDK，建议每个绑定独占 runtime，取消后回收，不把它宣传成原生精细停止。
2. **SDK 事件通知不等于实时 token 流，也不代表已刷盘。** 当前 SDK 远传原生日志类 session event，未桥接 `agent/assistant-stream` 的瞬态 chunk；ACP 同样明确只发送已提交消息、通用工具生命周期等语义更新。这里的“已提交”是运行时事件语义，不保证通知时已经持久化。不能原样保留 Axiom 逐 token 输出体验，需扩展桥。
3. **入队回执不等于执行结果或持久化完成。** SDK `prompt` 在 `followup()` 后返回 messageId，没有等待 session flush；高层 `run` 取活动区间最后提交的助手文本，且它不因果归属于该输入。需映射宿主 run/input/turn 身份，并区分接纳、执行、刷盘与宿主交付，不能用 `finalResponse` 单字段结算有追加、通知或后代的任务。
4. **SDK 没有通用宿主工具回调注册面。** 现有宿主回调是问答／审批，不是任意 `tools/call`。Axiom 的 memory、task 工具仍要通过受控 DSH 插件或 MCP 桥接。MCP 可传工具调用，但不能替代完整 runtime 控制协议。
5. **SDK 没有 fork、历史读取、显式 compact、动态切换模型等方法。** 这些原生能力有些存在于 DSH core，不代表跨进程接口已提供。恢复也只通知新事件，不回放旧历史；Axiom 历史页还需存档读取或扩展 export 接口。
6. **ACP 有停止／关闭，但不是完整呈现协议。** 当前无 transcript 回放、fork、DSH 专用卡片或原始增量／重试流；其上下文用量更新也不能未经核对就视为完整请求计费账单。`cancel` 只等待调用时已有的活动及排队输出，之后的子代理消息仍可能触发自主工作；宿主终止任务、回收 lease 时应 `close` 并确认后代 drain、flush 和作用域释放，必要时回收独占进程，不能只依据 cancel 响应。
7. **区分包版本和协议版本。** SDK 默认 launcher 会检查本地客户端与 dsh 包版本一致；但协议没有版本协商，握手 version 当前为 `0.0.1`，不等于产品 0.2.1-rc.3，客户端不校验这个握手版本。显式提供 `dshBin` 还会绕过默认包解析检查。适配器仍须固定发行版、验证所需方法与事件，不能只看握手成功。
8. **模型与凭据不会自动继承。** SDK 可复用已注册 adapter，但只对 deepseek-official 自动补挂载原生适配器；Axiom 的 CodeBuddy/Qoder/Kiro、OAuth 刷新、别名与网络代理须另行适配，不能直接复制 Pi 的 auth.json 当作兼容证明。

### 4.4 存档、压缩与安全

DSH 使用自己的 append-only SessionEvent 日志和模型历史派生机制，本轮代码 writer 为 **format v4**，有相邻版本迁移和不可覆盖的物理 generation（[格式状态](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/session-format-status.md)）。同为 JSONL 不表示与 Pi entry/tree/compaction 格式兼容。其原生 fork 是复制事件前缀形成独立会话，不是 Pi parentId 树导航；原生上下文压缩会提交摘要和替换上下文的 checkpoint，旧事件仍保留，区别于日志文件的 Zstd 压缩。

[持久化契约](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/session/session-persistence/README.md)以**完成 flush**为崩溃持久性屏障；`session/event` 先进入后台批处理。正常关闭要等待刷盘，强杀仍可能丢失尾部回复及用量。适配器不能把“已收到通知／messageId”记为“已安全保存”，也不能把强杀导致的未知尾部当作零费用。

[`sdk-minimal`](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/bundle/sdk-minimal/README.zh.md) 是精简运行组合，不是沙箱安全承诺，也不等于精简 npm 依赖分发。它默认带持久 shell、图片读取、工作目录工具和自动压缩，沙箱策略为 **danger-full-access**。不能直接把它当“只读研究代理”启动在正式工作区。

适配时要审计最终 profile，显式限制工具、文件和网络；关闭或接管与 Axiom 冲突的标题、记忆、subagent、goal、schedule、遥测、自动压缩等能力。不能让自动后台活动绕开执行许可或产生不可归属费用。所有插件都是受信代码；进程隔离不等于 OS 安全沙箱（[官方安全说明](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/SAFETY.zh.md)）。

### 4.5 Node 版本与分发边界

本轮 DSH 源码根项目及 CLI manifest 均声明 **Node >=24.9.0**，官方[运行时下限说明](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/.agents/notes/implemented/process/2026-10-15-node-24-runtime-floor.zh.md)明确不再支持 Node 22。Axiom [主包](../package.json)和[应用包](../app/package.json)仍声明 >=22.19.0，本会话工具实测为 22.23.2；未检查正式后台的实际 Node 版本。

而 [SDK launcher](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/sdk/client/src/launch.ts) 默认使用 `process.execPath` 启动 dsh，`dshBin` 只选择 JS 入口，不选择另一份 Node。因此“另起子进程”不会自动解决引擎差异：应为 DSH 控制 worker／运行时提供受支持 Node，或在批准升级 Axiom 引擎后统一运行；也可以直接用自有协议 launcher 指定解释器。

本轮 npm registry 返回的同版 dsh/client 元数据未带 engines，不能据此把 Node 22 当作受支持版本。源码、文档和发布载体应在后续安装验证中一起核对。本轮没有在 Node 22 或 24 执行候选，不能把版本声明当作已实测的启动失败／成功。

## 5. 建议的插件边界

后续细化见[通用 Agent Runtime 适配器契约](agent-runtime-adapter-contract.md)：明确核心接口、可选扩展、许可/停止屏障、工具与事件端口及现有调用迁移。本节保留调研阶段的边界简图和最小示意，不代表业务接口已实现。

```text
Axiom UI / 记忆业务 / Tasks / 授权 / 费用归属
                    │
        宿主会话服务 + 中性事件／历史投影
                    │
     RuntimeRegistry + 现有 ExecutionPool / Lease
              ┌─────┴───────────────┐
           PiAdapter             DshAdapter
         Pi SDK worker       Node控制worker → DSH子进程
              │                    │
         Pi原生存档           DSH原生Session日志

ModelGateway（与AgentRuntime分层，可暂时保留pi-ai）
ToolGateway（宿主授权、身份、结果及副作用边界）
```

这里的 ModelGateway/ToolGateway 是职责边界建议，不是要求先搭建新的服务平台或额外网络层。

### 最小契约草案（未实现）

```ts
interface AgentRuntimeAdapter {
  id: string;
  version: string;
  capabilities: RuntimeCapabilities;
  prepareProfile(input: HostSessionConfig): Promise<PreparedRuntimeProfile>;
  open(binding: HostBinding): Promise<RuntimeSession>;
  readHistory(ref: NativeSessionRef): Promise<HostHistoryProjection>;
}
interface RuntimeSession {
  submit(input: HostInput): Promise<InputReceipt>;
  cancel(reason: string): Promise<StopReceipt>;
  events: AsyncIterable<HostRuntimeEvent>;
  close(): Promise<void>;
}
```

接口名仅作示意。关键不是方法数量，而是语义明确：

- **宿主身份**：workspace/session/run/input/toolCall/request/result/lease/generation 关联；持久入队、执行结算、保存及通知是不同事实。
- **能力协商**：token streaming、steer、follow-up、撤回、reload、fork、历史编辑、native compaction、安全恢复、用量明细逐项声明。不支持的入口关闭并说明，不能假装成功或无声降级。
- **持久归属**：会话保存 runtimeId、适配器／原生格式版本、原生 sessionRef、profile/契约修订；不得把凭据正文写入元数据。旧会话缺字段时明确按历史 Pi 解释。
- **工具控制**：工具 schema、模型正文与宿主 details 分开；宿主复核参数、权限和所有权；信号传播后等待真实停稳，未知副作用不重放。主代理的记忆文件权限不能被另一个 runtime 的原生 shell 绕过。
- **事件与展示**：中性 DTO 描述可证实的文本、工具、失败、重试、请求和结算；原生事件留存用于诊断，不直接把原始 payload 发前端。可以区分原生 phase，不要求所有 runtime 假造 Pi 的 commentary/final 语义。
- **压缩控制**：每种 runtime 只有一个压缩控制者。DSH 的原生压缩要么先禁用，要么作为自身明确能力接入；不把 Axiom 原 Pi compact/apply 同时强加到同一 DSH 日志。
- **账源唯一**：记录实际 provider/model/usage/缓存及价格快照或可核验费用，失败和取消也可能收费；拿不到记未知，不记零，也不把多种投影重复累加。
- **物理执行**：DSH 子进程由原池中的控制 worker 拥有；清理必须覆盖子进程／后代与持久化。资源预算统计完整进程树，不因外层只有一个 worker 就忽略内层消耗。

### 会话切换原则

1. 默认按会话固定 runtime；同会话只允许单写者，原生存档继续由原 runtime 解释。
2. 新建或显式分叉一个会话时可选择另一 runtime。
3. 跨 runtime 续接先定义“显式交接”：带来源的文字／附件／工具状态摘要，保留原历史只读关联。不要无损承诺搬运 provider 签名、原生工具状态、请求上下文和压缩边界。
4. 热切换不是首版要求；如后续确有需求，单独设计转换与损失报告，不能静默把两个日志拼接。

## 6. 推荐推进顺序与验收

### 阶段一：先封装 Pi，不改变行为

抽出 runtime/profile、native session repository、事件／历史投影、工具包装边界。仍只运行 Pi，现有存档不迁移，现有主子代理、记忆、费用和压缩全量回归。

此步必须证明“封装后行为不变”，而不是先宣布插件化完成。标题、查询、整理等独立模型作业可继续现有实现，不强迫全部变成 harness 会话。

### 阶段二：第二 runtime 做受限子任务验证

先用隔离 workspace、独立 DSH_HOME、受支持 Node、固定版本与 profile，关闭写入、自由 shell、内置委派和自主后台活动。优先比较 **ACP 的可取消自动化** 与 **SDK 的原生事件可见性**：

- ACP 更适合验证研究／分析子任务的完整生命周期；终止／回收使用 close 的停稳屏障，不只发送 cancel。不是据此承诺可替换主聊天。
- SDK 更适合核对原生日志与事件映射；独占进程并明确取消语义，不满足流式体验时不得隐藏差异。
- 若所需能力不能从现成协议获得，再实现一个小型可信 DSH bridge 插件；不应一开始 fork DSH 核心。

混合父子 runtime 是候选验证场景，不是本轮已支持的功能。继续由 Axiom Tasks 保存精确结果、通知和 read_result，不让 DSH 再建第二套任务事实。

### 阶段三：按证据开放新主会话

补齐 token 流、工具／记忆桥、历史读取、恢复、请求费用和实际用到的交互能力后，才开放新主会话选择 DSH。fork/reload/压缩等若未实现，在能力层关闭；产品若要求这些功能，则属于尚未达到替换门槛，不能把关闭当验收通过。

### 最低测试矩阵（后续实施要求，本轮未执行）

| 维度 | 要验证的边界 |
| --- | --- |
| Pi 回归 | 同一固定存档／假模型下消息、工具、追加、停止、reload、分支、费用、压缩不变 |
| 生命周期 | 初始化失败、超时、取消、进程崩溃、迟到 lease、清理失败、子进程残留、恢复后不自动重复工具 |
| 输入与交付 | 区分接纳与持久化回执、重复/未知投递、追加参与活动区间、任务精确 taskId/resultId、结果先存后通知 |
| 安全 | 未授权工具、路径逃逸、记忆跨会话写入、凭据泄漏、默认profile扩权、自主请求绕过执行许可 |
| 持久化 | 旧 Pi 历史可读、DSH 重启恢复、单写者、归属与格式版本拒绝、历史不因压缩消失 |
| 费用 | 请求重复事件去重、多次摘要、缓存 token、取消迟到用量、未知账单不为零、不重复归集 |
| UI 能力 | 无 token 流不伪造、无 fork 不展示可用按钮、原生失败不被误标成功、读详情不触发模型 |

先做假模型、协议 fixture 与故障注入；真实模型质量对比、正式数据及部署需要后续实施授权。本轮没有成本、质量或性能实测，不能得出 DSH 比 Pi 更快、更便宜或更聪明的结论。

## 7. 最终建议

**架构上值得做“可替换底层”，实施上先“Pi 适配器化 + DSH 受限第二实现”。** 把插件接口建在 Axiom 自己的会话／工具／事件／持久化边界，不建在 Pi 的类型上，也不直接继承 DSH 的完整产品默认行为。

初期可行性验证的成功标志是：**不改变 Pi 的现有行为，第二个 runtime 能在同一宿主调度和安全契约内完成一个可停止、可恢复、可审计的真实子任务。** 主聊天等价替换及跨 runtime 无损热切换，不能由这个小验证自动推出。
