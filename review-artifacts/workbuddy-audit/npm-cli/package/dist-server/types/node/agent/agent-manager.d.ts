import { Deferred, Emitter, Logger } from '@celljs/core';
import { AuthenticationManager } from '@genie/authentication';
import { AgentFactory, AgentManager, type EffectiveModelResolution, type EffectiveModelSource, PromptContextProvider, PromptRenderer, Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { PluginManager } from '../../vendor/cbc-plugins/node/index.js';
import { Agent, FunctionTool, RunContext } from '../../vendor/cbc-shared/node/index.js';
import { type Agent as ProductAgentConfiguration, type Command, type LanguageModel, type ModelVariantType, ProductManager } from '@genie/product';
import { A2aDiscoveryReadyService } from '../a2a/a2a-protocol';
import { CliProvider } from '../cli/cli-protocol';
import { type ITuiModeService } from '../cli/tui-mode-service';
import { CommandManager } from '../command';
import { type IMcpFirstRunStatusService } from '../mcp/mcp-first-run-status-protocol';
import { AgentScopedMcpManager, McpManager, McpReadyService, type MCPServer, McpServerManager, McpSubagentToolManager } from '../mcp/mcp-protocol';
import { OutputStyleManager } from '../output-style/output-style-protocol';
import { type IPrewarmStateService } from '../prewarm/prewarm-protocol';
import { type SecurityReviewGate as SecurityReviewGateContract } from '../security-review';
import { SettingsManager } from '../settings/settings-protocol';
import { DeferToolConfigService } from '../tools/defer-tool-config-protocol';
import { Tool, ToolInputParameters, ToolManager } from '../tools/tool-protocol';
import { type ToolRiskReviewService as IToolRiskReviewService } from '../tools/tool-risk-review/protocol';
import { ToolSearchService } from '../tools/tool-search-protocol';
import { AgentToolDeferOverlayCache } from '../tools/tool-spec';
import { type AgentMemoryScope } from './agent-memory';
interface InitializeMetadataSnapshot {
    defaultAgentName: string;
    models: LanguageModel[];
    currentModelId?: string;
}
/**
 * Agent「拒绝启动」错误（Claude Code parity，v2.1.208）：显式声明的 tools 白名单
 * 全部无法解析时由 buildTools 抛出。
 *
 * 注册批对该错误做单 agent 隔离（记录到 agentLaunchErrors，不引爆整个 rebuild）；
 * spawn 路径（AgentManager.get）命中记录时重抛本错误，让未解析明细到达触发点。
 * 其他系统性错误不走本类型，保持原有的整批失败语义。
 */
export declare class AgentLaunchError extends Error {
    constructor(message: string);
}
export declare class AgentManagerImpl implements AgentManager {
    protected readonly productManager: ProductManager;
    protected readonly authenticationManager: AuthenticationManager;
    protected readonly factory: AgentFactory;
    protected readonly toolManager: ToolManager;
    protected readonly toolRiskReviewService?: IToolRiskReviewService;
    protected readonly securityReviewGate: SecurityReviewGateContract;
    protected readonly commandManager: CommandManager;
    protected readonly promptRenderer: PromptRenderer;
    protected readonly promptContextProvider?: PromptContextProvider;
    protected readonly settingsManager: SettingsManager;
    protected readonly mcpManager: McpManager;
    protected readonly mcpReadyService: McpReadyService;
    protected readonly mcpServerManager: McpServerManager;
    protected readonly mcpSubagentToolManager: McpSubagentToolManager;
    protected readonly agentScopedMcpManager: AgentScopedMcpManager;
    protected readonly sessionManager: SessionManager;
    protected readonly cliProvider: CliProvider;
    protected readonly prewarmStateService?: IPrewarmStateService;
    protected readonly tuiModeService?: ITuiModeService;
    protected readonly mcpFirstRunStatusService?: IMcpFirstRunStatusService;
    protected readonly a2aDiscoveryReadyService?: A2aDiscoveryReadyService;
    protected readonly outputStyleManager: OutputStyleManager;
    protected readonly pluginManager?: PluginManager;
    protected readonly logger: Logger;
    protected readonly deferToolConfigService: DeferToolConfigService;
    protected readonly agentToolDeferOverlayCache: AgentToolDeferOverlayCache;
    protected readonly toolSearchService: ToolSearchService;
    protected readonly prewarmState?: IPrewarmStateService;
    protected agentMap: Map<string, Agent>;
    /**
     * Exact Agent objects that have actually been published through `agentMap`,
     * including historical generations replaced by Product reload. Weak
     * identity tracking does not retain obsolete runtimes.
     */
    private managedAgentInstances;
    /**
     * session-agent-view 缓存：session → (agentName → 视图与失效判据)。弱键随
     * 会话对象回收（served 钝化释放会话即释放视图），无显式清理面。惰性初始化
     * 与 managedAgentInstances 同款（Object.create 测试架子不跑字段初始化器）。
     */
    private sessionAgentViews?;
    /**
     * 会话档注入 agent（`QueryOptions.agents`，#108461 D6）的每会话已构建实例缓存：
     * session → (agentName → 已构建 Agent)。弱键随会话回收（同 sessionAgentViews，
     * 无显式清理面）。`get()` 首次解析到会话注入 agent 时懒构建
     * （registerAgent + skipMapRegistration，不写全局 agentMap）并缓存于此。
     */
    private sessionBuiltAgents?;
    /**
     * ToolSearchService index epoch each mapped agent's tool array was built
     * against. A late-connecting MCP server indexes its deferred tools long
     * after the agent was frozen; the run path compares this stamp against the
     * live epoch to detect a stale agent and refresh it before the first run.
     * Keyed by agent name (mirrors `agentMap`).
     */
    protected agentToolEpoch: Map<string, number>;
    /** Version of ToolManager's dynamic registry baked into each SDK Agent. */
    private agentToolRegistryVersions?;
    /** Sessions that have already paid the Claude-style bounded MCP pre-wait. */
    private sessionMcpPrewaitCompleted;
    /** Deduplicates overlapping dispatch attempts for the same Session object. */
    private sessionMcpPrewaitInFlight;
    /**
     * Sessions that have already paid the bounded outbound-A2A discovery
     * prewait (see ensureAgentToolsFreshForRun). Once per session: turn 2+
     * relies on the reactive registry refresh (ToolManager.setupA2aRegistryCallback)
     * instead of re-waiting.
     */
    private sessionA2aPrewaitCompleted;
    /**
     * 进程级 first-run MCP prewait 单实例 latch。TUI 静默启动阶段的 warm-up 与
     * 首个 user prompt 的 run 路径都命中此 latch ——谁先 acquire 谁真正驱动
     * `runFirstSessionMcpPrewait`，第二个调用者直接 await 同一个 promise。
     *
     * 语义变化说明：现在 `runFirstSessionMcpPrewait` 的调用严格 per-process一次
     * （之前是 per-session，第二个 session 又会跑一遍；本 latch 收敛为一次）。
     * 这与Claude Code 上游"first-run"语义一致（一个进程内只有一次首次连接窗口）。
     */
    private firstRunMcpPrewaitLatch;
    /**
     * 与 {@link firstRunMcpPrewaitLatch} 配套的中断句柄。TUI 侧按 ESC 或用户
     * 发出首个 prompt 时调用 {@link interruptFirstRunMcpPrewait} 打断——
     * `waitForPendingServers` 立刻返回，`McpFirstRunStatusService.emitFinish`
     * 会把未 settle 的 server 标记为 `timeout`；agent-service.run 的调用者随即
     * 得到 'completed' 或 'aborted'，立即用当前已连的 MCP 集派出模型请求，避免
     * 用户发消息后卡在无 UI 反馈的 prewait 阻塞窗口。
     *
     * 中断不影响 mcpManager 的后台 reconcile ——未 settle 的 MCP 仍会继续连接，
     * `onDidChangeIndex` 触发下一轮 rebuild 时它们的工具会正常并入。
     */
    private firstRunMcpPrewaitAborter;
    /**
     * 进程级"用户已主动打断首轮 MCP prewait"标志。**仅 TUI 侧**会置位：用户按
     * ESC 或发出 prompt 时经 {@link interruptFirstRunMcpPrewait} 打断，语义是
     * "我不要再等 MCP 了，直接发 prompt"。
     *
     * 为什么需要这个标志（否则会有 banner 复发 bug）：
     * 打断只让**当前**这一轮 prewait 提前结束、返回 'aborted'。而 'aborted'在
     * {@link acquireFirstRunMcpPrewait} 里会清空 latch、且不进`sessionMcpPrewaitCompleted`
     * ——这是为 stdio/程序化调用保留"下一轮持live signal 重试"的机会。但 TUI 里
     * 紧接着的 `runDefault → ensureAgentToolsFreshForRun` 会立刻再acquire 一次，
     * 于是**又起一轮 prewait、又 emit start、banner 重新出现、又阻塞满timeout**
     * （用户实测：发 prompt 后 banner 不消失、仍等满 15s；ESC 后再发消息 banner 又冒出来）。
     *
     * 置位后 {@link acquireFirstRunMcpPrewait} 直接快返 'completed'，不再启动新一轮
     * prewait、不再 emit start——TUI 用户打断即"永久跳过"本进程首轮 prewait，prompt
     * 立即派发。MCP 后台 reconcile 不受影响。
     *
     * stdio / SDK 链路**没有任何** interrupt 调用点（唯一调用点在 TUI 的
     * use-message-sender / mcp-startup-banner），此标志永不置位，stdio 保持既有
     * 2s 整体等待语义不变。
     */
    private firstRunMcpPrewaitUserInterrupted;
    protected agentConfigMap: Map<string, ProductAgentConfiguration>;
    /**
     * 拒启动错误明细（agent 名 → AgentLaunchError）。注册批单 agent 隔离时写入，
     * 每次 rebuild 注册批前清空重算；spawn 路径（get）命中时抛出，替代通用 not-found。
     */
    protected agentLaunchErrors: Map<string, Error>;
    protected modelMap: Map<string, LanguageModel>;
    protected readyDeferred: Deferred<void>;
    /**
     * Resolves once the product config has been parsed into `agentConfigMap` /
     * `modelMap` / `defaultAgentName` — i.e. after `buildAgentsFromProductConfiguration`
     * populates those maps but BEFORE the `registerAgent` loop that awaits MCP
     * settle (`buildMcpServers → waitForServersReady`).
     *
     * `readyDeferred` only resolves after the full rebuild, including that MCP
     * wait; metadata-only consumers (the SDK `initialize` handshake: models /
     * commands / default agent name / account) must NOT pay that latency, since
     * in stdio/stream-json mode a slow MCP would otherwise stall `initialize`
     * for seconds. Those consumers await this lighter signal instead. Actual
     * agent execution (`get()` / `getDefault()`) still awaits `readyDeferred`
     * because it needs registered Agent instances with their MCP wiring.
     */
    protected configReadyDeferred: Deferred<void>;
    protected modelsReadyDeferred: Deferred<void> | undefined;
    /**
     * initialize 握手专用的**元数据快照** promise。
     *
     * 由 `@PostConstruct init()` 在 rebuildAgents 前就 fire-and-forget 启动：
     *   `productManager.waitConfiguration()` → 从 raw agents/models 里直接算出
     *   `defaultAgentName` / `models` / `currentModelId`。
     *
     * 关键：它绕开 `buildAgentsFromProductConfiguration` 内部的 fingerprint 判断、
     * `applyPluginAgentSetting` / `applySettingsAgent` / `get('permissions')` 等
     * 前置工作 —— 这些在真实沙箱冷启动样本里能吃掉 ~380ms（configReadyDeferred=388ms
     * 而 waitConfiguration 本身 <10ms）。initialize 握手只需元信息（模型列表、
     * default agent 名、当前主模型 id），本不该在这段前置上等。
     *
     * `getInitializeMetadata()` 只 await 本 promise；真正的 agent 执行仍走
     * `readyDeferred`，语义不变。
     */
    protected initializeMetadataPromise?: Promise<InitializeMetadataSnapshot>;
    protected _ready: boolean;
    protected rebuilding: boolean;
    protected pendingRebuild: boolean;
    protected pendingForceRebuild: boolean;
    protected lastConfigHash: string;
    protected lastNonModelConfigHash: string;
    /** Final outcome of the most recently settled rebuild. Best-effort callers log it; explicit refresh rethrows it. */
    protected lastRebuildFailure: {
        error: unknown;
    } | undefined;
    /**
     * 串行累积的「后台初始化覆盖」链（SDK initialize 的 systemPrompt / agents 注入）。
     * `get()` / `getDefault()` 在返回 agent 前 await 它，确保首个 run 跑在覆盖生效之后。
     * 见 `trackPendingInitializeOverride`。
     */
    protected pendingInitializeOverride: Promise<void>;
    /**
     * rebuild 稳定态事件：当 `rebuildAgents` 完成且没有待处理的 pendingRebuild 时触发。
     */
    protected readonly onDidRebuildSettledEmitter: Emitter<void>;
    private processDefaultAgentName;
    protected get defaultAgentName(): string;
    protected set defaultAgentName(name: string);
    protected get currentModelMap(): ReadonlyMap<string, LanguageModel>;
    protected get currentAgentConfigMap(): ReadonlyMap<string, ProductAgentConfiguration>;
    protected volatilePluginAgentName?: string;
    protected settingsAgentName?: string;
    protected volatilePluginSourcePluginId?: string;
    protected volatilePluginInternalModelRequestHeaders?: Record<string, string>;
    /**
     * Agents whose `agentConfigMap` entry carries a runtime-patched tool list.
     *
     * Written by plugin agent compose (`applyPluginAgentSetting`,
     * `applyReplacePluginAgentBaseBeforeVolatile`) and by the settings/`--agent`
     * override (`applySettingsAgent`). All of them land the patched config only
     * in `agentConfigMap` and in the filtered agent view used for registration —
     * Product configuration keeps the un-patched default agent. Any path that
     * re-reads Product config must therefore not take `tools` from there for
     * these agents, or it silently reverts them to the un-patched list.
     */
    protected readonly agentsWithPatchedTools: Set<string>;
    protected init(): void;
    get ready(): boolean;
    getDefaultAgentName(): string;
    isManagedAgentInstance(agent: Agent): boolean;
    createRunScopedAgent(agent: Agent, session?: Session): Promise<Agent>;
    /**
     * session-agent-view：进程物化 agent 之上的会话档视图。
     *
     * 全局 agent.tools 的描述（<available_skills> / 自定义命令目录 / ToolSearch
     * 延迟清单 / A2A 目录）在会话 scope 外物化+缓存，served 多会话进程里对
     * 会话档输入天然失明（lamp 技能不可用事故根因）。视图在激活期构建一次
     * （served 激活链经 prepareSessionAgentView 预热）、派发期按失效判据复用：
     * 表内工具的描述换成视图内渲染的字节，其余工具对象原样共享。
     *
     * 纪律：视图字节只挂在视图上，永不写回全局描述缓存或 agentMap（反向即跨
     * 会话泄漏）；同会话输入不变时逐轮返回同一视图对象——描述字节稳定，prompt
     * cache 不受扰动。无活体输入（bin / ACP / 未带会话档且无 A2A 目录的会话）
     * 直接返回基座，零分配。
     */
    sessionScopedAgentView(session: Session, base: Agent): Promise<Agent>;
    /**
     * served 激活链的视图预热（"激活期构建一次"）；派发路径是失效兜底。
     * 预热对象近似跟随会话主 agent 席位（session.agentName + Step-1 排除项）；
     * 权威解析在派发期 resolveMainAgentForSession——预热偏差只损失一次冷构建。
     */
    prepareSessionAgentView(session: Session): Promise<void>;
    /**
     * 视图活体输入解析：skills/commands 按归属会话（主会话）直取；tools 白名单
     * 指纹按传入会话取（per-agent options 语义，子代理沿自身 options）——
     * 进程级 --tools 不计入会话维度（见 resolveSessionToolContext）。A2A 目录
     * 指纹**只对会话源会话计入**：进程源会话的 A2AGetAgentCard 清单由反应链
     * （register→refreshAgentTools 换基座 tools 数组）保鲜，走基座即可，喂指纹
     * 只会为每个进程源会话多建一份字节等同基座的视图（与 ensureAgentToolsFreshForRun
     * 的 kind==='process' 刷基座分支同一分工）；会话源 register 刻意不发反应链
     * （registerForSource 不 notify），基座永不刷，故必须经视图指纹保鲜。全空
     * 返回 undefined = 无视图。
     */
    private collectSessionViewInputs;
    /**
     * Agent 工具目录里的会话档 agent：去掉会话插件 settings.agent 指定的根，与进程档
     * removePluginSettingAgentsFromStandaloneRegistry 同一判据（所有插件的声明，默认 agent 除外）。
     * 只影响目录；派发仍按会话档解析。
     */
    private listedSessionAgents;
    private buildSessionAgentView;
    /**
     * 克隆一个工具对象并**重打 promptCacheStability 标记**。
     *
     * 描述符克隆保原型与全部自有属性（spread 会丢类方法）；稳定性标记存 WeakMap、
     * 不随原型链继承 —— 漏打只表现为 prompt cache 判据静默漂移，没有断言会红，
     * 所以克隆与重打必须成对封装（原先两处各写一遍）。
     */
    private cloneToolPreservingStability;
    /**
     * 沙箱身份视图：把 REPL 工具的**动态 schema** 按子代理身份重新物化一遍。
     *
     * 为什么需要：Code Mode 的 agent 实例是**进程级共享**的（`get('ptc')` 每次命中同一个
     * 对象），它的 REPL schema 在构建期用合成会话采集 —— 那一刻没有「谁在跑」这回事。
     * 继承模式的子代理因此拿到**模式的全量目录**：用户实测 Explore 的沙箱目录里出现 Edit。
     * 能力本身没泄漏（执行 / 发现层按 live session 判白名单，见 repl-bridge-broker），
     * 但注入的目录文本必须与「调得动」一致，否则模型照抄一个不存在的全局。
     *
     * 只克隆 REPL 一个工具（其余工具对象原样共享），只在派发侧对**子代理**使用：主会话不传
     * 身份，行为与基座逐字节一致。视图不进 agentMap、不写回全局描述缓存。
     *
     * ⚠️ 视图**刻意不登记** `managedAgentInstances`：那是 run 期投影的判据
     * （`ensureAgentToolsFreshForRun` 把 managed 的 run 克隆的 tools 换成模式全量，
     * 会把这里的窄 schema 冲掉）。非 managed 的 run agent 在 agent-service 里
     * `managedExactAgent` 传 undefined → 投影整个跳过。这条不变量有 spec 守着。
     */
    sandboxScopedAgentView(base: Agent, sandboxAgentName: string): Promise<Agent>;
    getDefault(): Promise<Agent>;
    getPrimaryModel(): Promise<LanguageModel>;
    getSettingsAgentName(): string | undefined;
    getCliAgentName(): string | undefined;
    getVolatilePluginAgentState(): {
        agentName?: string;
        sourcePluginId?: string;
        internalModelRequestHeaders?: Record<string, string>;
    };
    setVolatilePluginAgent(agentName?: string, options?: {
        rebuild?: boolean;
        sourcePluginId?: string;
        internalModelRequestHeaders?: Record<string, string>;
    }): Promise<boolean>;
    get(agentName: string): Promise<Agent | undefined>;
    /**
     * 懒构建并缓存一个会话档注入 agent（#108461 D6）。用现有 registerAgent 管线构建
     * （skipMapRegistration=true → 只返回实例、不写全局 agentMap），按 session 缓存。
     */
    private getOrBuildSessionAgent;
    getRegistered(agentName: string): Agent | undefined;
    getAgentConfig(agentName: string): Promise<ProductAgentConfiguration | undefined>;
    /** Plugin settings are below an explicitly supplied same-name session Agent. */
    private sessionDefaultPlugin;
    private applySessionPluginTools;
    /**
     * 刷新特定 agent 的工具列表。用于在 delegate tools 注册后动态更新 DelegateTool 的描述。
     * 重新构建指定 agent 的工具列表并替换现有的 agent.tools。
     */
    refreshAgentTools(agentName: string): Promise<void>;
    /**
     * Run-path guard against the "first prompt misses MCP tools" race.
     *
     * The ToolSearch description is frozen into an agent's tool array at
     * buildTools time. A late-connecting MCP server (esp. remote HTTP behind
     * auth-proxy) indexes its deferred tools asynchronously long after that; the
     * `onDidChangeIndex` signal only invalidates the description *cache* — it
     * does NOT rebuild an already-frozen agent instance. So whether the first
     * prompt carries the MCP tools depended on an unrelated `rebuildAgents`
     * happening to land between "MCP indexed" and "first run" — a race that is
     * only sometimes won (hence the intermittency).
     *
     * This method closes the gap on the run path: the first run gives fast MCP
     * servers a bounded 2s window to connect and index, then re-bakes the agent
     * iff the tool-search index advanced. Slow optional servers continue in the
     * background and can be picked up by a later run. A managed exact Agent may
     * receive the latest same-name tools; derived/per-request Agent overrides
     * are intentionally left untouched.
     *
     * IMPORTANT — do NOT move this into `get()` / `getDefault()`. Those funnel
     * `initialize` and `get_available_models` (via `getModelsInfo`), which must
     * stay off the MCP-settle critical path (#67906). Only the actual run path
     * may pay this bounded gate: it runs immediately before the first model
     * dispatch, without delaying metadata/initialization requests.
     */
    ensureAgentToolsFreshForRun(agentName: string, session: Session, signal?: AbortSignal, exactAgent?: Agent): Promise<void>;
    /**
     * Reuse discovery's bounded, cancellable wait; a cancelled first dispatch
     * re-waits on its next turn (mirrors the MCP prewait's retry treatment).
     */
    private prewarmA2aForRun;
    /** Stop waiting on shared preparation without cancelling it for other runs. */
    private waitForRunPreparation;
    /**
     * Select the Claude-style first-dispatch wait set.
     *
     * Without ToolSearch every MCP tool is potentially inline, so `undefined`
     * preserves the legacy "all pending" wait. With ToolSearch, a fully deferred
     * server is represented by the pending snapshot and can finish in the
     * background; only servers that can contribute an inline tool need the
     * bounded prewait. `alwaysLoad` is accepted as a Claude-compatible escape
     * hatch even though WorkBuddy normally expresses the same intent through
     * `defer_loading: false`.
     */
    private getFirstRunMcpPrewaitNames;
    /**
     * 进程级 first-run MCP prewait latch。TUI 早期 warm-up 与首个 user prompt
     * 的 run 路径都命中此入口——**同一进程内 prewait 只跑一次**。
     *
     * 目的：TUI 启动后需要在**无用户消息**的静默阶段就展示 `Starting MCP servers`
     * 顶部状态行；这要求 prewait 提前触发以emit start事件。若 warm-up 触发一次、
     * 首个 prompt 又触发一次，会重复 emit / 重复启动 waitForPendingServers。用
     * 一个共享 promise 保证第二个调用者直接 await 第一个的结果。
     *
     * 并发调用者语义（首个 prompt 抵达时 warm-up 尚未完成）：
     * - 首个 prompt 得到与 warm-up 完全一致的 outcome（'completed' / 'aborted'）
     * - abort signal 只影响第一个（激活latch 的那个）调用者——warm-up 的 signal
     *   是 undefined，首个 prompt 的 signal 是 session abort controller。目前 latch
     *   共享同一 signal 的语义是"以第一个为准"，这与"只跑一次"目标一致；后续 run
     *   本就走 sessionMcpPrewaitCompleted 快路径不需要 signal。
     */
    private acquireFirstRunMcpPrewait;
    /**
     * 中断进程级 first-run prewait 等待——**不停 MCP 后台建联**。
     *
     * 语义：`waitForPendingServers` 立刻返回，`McpFirstRunStatusService.emitFinish`
     * 会把未settle 的 server 标记为 `timeout`；agent-service.run 立即用当前
     * 已连的 MCP 集派模型请求。未 ready 的 MCP 仍会在后台 reconcile，下一轮
     * rebuild 时它们的工具正常并入——用户下一条消息即可用上完整工具。
     *
     * 调用方：TUI banner ESC / hasUserMessage=true 时；stdio 侧客户端也可通过
     * ACP interrupt 请求触达同一效果（未来扩展）。多次调用幂等——一旦打断，
     * {@link firstRunMcpPrewaitUserInterrupted} 置位，后续本进程的 acquire 全部
     * 快返 'completed'，既不会重复 abort 也不会起新一轮 prewait。
     */
    interruptFirstRunMcpPrewait(): void;
    /**
     * 组合两个 AbortSignal ——任一 abort 则整体 abort。用于把 latch 内部的
     * 中断句柄与外部调用方 signal 合并，避免调用方需要感知 latch 内部机制。
     */
    private linkAbortSignals;
    /**
     * TUI 静默启动阶段的显式预触发入口。TUI ready后 fire-and-forget 调用一次，
     * 让 `McpFirstRunStatusService.emitStart` 提前发出，`McpStartupBanner`
     * 无需等首个用户消息就能渲染顶部状态行。
     *
     * 与首个 prompt 的 run 路径共享同一进程级 latch（{@link acquireFirstRunMcpPrewait}）；
     * warm-up 先跑则首个 prompt 直接 await 已 resolve 的 promise，反之亦然，绝不会
     * 重复触发 `waitForPendingServers` / 重复 emit 事件。
     *
     * @param agentName 用哪个 agent 的prewait 名单选择器；默认 'cli'。
     * @param session   warm-up 专用 session；首个 prompt 的真实 session 与本 session
     *                  是不同对象，通过全局 latch 而非 sessionMcpPrewaitCompleted 去重。
     */
    warmupFirstRunMcpPrewait(agentName: string, session: Session): Promise<'completed' | 'aborted'>;
    /**
     * Run the entire first-session MCP gate under one deadline. Configuration
     * projection/name selection is part of the same 2s (or TUI 30s) budget;
     * it cannot add a second unbounded wait before `waitForPendingServers`.
     */
    private runFirstSessionMcpPrewait;
    private getMcpPrewaitToolNameCandidates;
    private overlayMayExposeInlineMcpTool;
    private mcpGlobMayTargetServer;
    private matchesSimpleToolGlob;
    protected rebuildAgents(force?: boolean): Promise<void>;
    onDidRebuildSettled(listener: () => void): {
        dispose(): void;
    };
    /**
     * Check if model map contains only placeholder model IDs (from base product.json).
     * Placeholder models have IDs like "default-model", "default-model-lite" — they're not
     * real model IDs that the LLM API can accept.
     * An empty catalog is a terminal configuration, not a placeholder snapshot: callers must
     * observe the empty result or fail model selection instead of waiting for a rebuild that
     * may never arrive.
     */
    protected hasPlaceholderModels(): boolean;
    protected buildAgentsFromProductConfiguration(force?: boolean): Promise<void>;
    /**
     * 拒绝发布「没有默认 agent」的快照，fail closed（#83859 家族洞的基准版防线）：
     * 空 agent 视图会让 Promise.all([]) 立即 resolve，构建看似成功——若就此收尾，
     * getDefault() 必然抛错，且 lastConfigHash 已写入会让下一次 rebuild 被判成
     * 「配置未变化」early-return，进程无法自愈。这里抛错并清掉 hash，让下一次
     * 配置事件真正触发重建。defaultAgentName 为空表示尚未表达默认 agent 语义，不参与判定。
     */
    protected assertRegisteredDefaultAgent(cliAgentsCount: number): void;
    /**
     * 注册批内的 per-agent 隔离包装（保持「显式 tools 全部无法解析即拒启动」语义，
     * 只改引爆方式）：
     *   - AgentLaunchError（拒启动）：该 agent 不注册，错误明细记入 agentLaunchErrors
     *     （spawn 时由 get() 重抛），其余 agent 正常完成注册；
     *   - 其他系统性错误：继续上抛（保留 lastRebuildFailure / refreshAgents 重抛语义）。
     */
    protected registerAgentIsolated(config: ProductAgentConfiguration, isSubagentOfDefault?: boolean, cachedPermissions?: Record<string, any>, cachedProductConfig?: {
        agents?: any[];
        models?: LanguageModel[];
        skills?: any[];
        commands?: Command[];
        tools?: any[];
    }): Promise<Agent | undefined>;
    /**
     * A mod's `$.agent.register(spec)` (official `AgentSpec`): a subagent type for this
     * process, under its full name `<plugin>:<name>`, tagged as a plugin's.
     *
     * @returns the full name
     */
    registerModAgent(plugin: string, spec: Record<string, unknown>): Promise<string>;
    /** Remove plugin-owned Agent state before rebuilding from the active snapshot. */
    private clearPluginAgentRuntimeState;
    protected registerAgent(config: ProductAgentConfiguration, isSubagentOfDefault?: boolean, cachedPermissions?: Record<string, any>, cachedProductConfig?: {
        agents?: any[];
        models?: LanguageModel[];
        skills?: any[];
        commands?: Command[];
        tools?: any[];
    }, options?: {
        skipMapRegistration?: boolean;
    }): Promise<Agent>;
    protected parseParametersToZod(parameters?: string | Record<string, any>): ToolInputParameters | undefined;
    protected buildTools(toolNames: string[], agentConfig: ProductAgentConfiguration, cachedPermissions?: Record<string, any>, cachedProductConfig?: {
        agents?: any[];
        models?: LanguageModel[];
        skills?: any[];
        commands?: Command[];
        tools?: any[];
    }, declaredToolNames?: readonly string[]): Promise<FunctionTool[]>;
    private createToolRiskReviewNeedsApproval;
    /**
     * 解析 agentConfig.tools 中的 Defer(...)/NoDefer(...) 修饰，剥离修饰后返回纯名数组，
     * 同时把 overlay snapshot 写入 AgentToolDeferOverlayCache（key=agentName）。
     *
     * 设计要点：
     *   - lenient=true：损坏配置（如 `Defer()`）只发 warning 不抛错，避免一个坏的
     *     custom agent 文件让整个进程的 agent build 崩溃。
     *   - 总是覆写缓存：buildTools 每次都会跑，product 配置 reload 后重新解析的 overlay
     *     会自然替换旧值。
     *   - 没有 agentName 也允许（个别测试场景），此时不写缓存仅做规范化。
     */
    private normalizeAgentToolSpecs;
    /**
     * Create isEnabled checker function for a tool.
     * Integrates multiple check layers: original isEnabled, tools whitelist, disallowedTools, defer_loading.
     *
     * Note: For deferred tools, set `runContext.skipActivationCheck = true` to skip the activation check.
     * This is used by ToolSearch to check if a tool CAN be activated (without requiring it to be activated first).
     */
    protected createIsEnabledChecker(toolOptions: Tool<any, any>, originalIsEnabled: Tool<any, any>['isEnabled']): Promise<(args: {
        runContext: RunContext<Session>;
        agent: Agent;
    }) => Promise<boolean>>;
    /**
     * Push SendMessage onto the agent's tool list when appropriate.
     *
     * SendMessage / MessageColleague are auto-injected for the default agent and
     * most sub-agents so communication "just works" without each `agents[].tools`
     * entry having to remember them.
     *
     * SendMessage = Agent Teams. MessageColleague / SpeakInChannel = Agent Home。
     * ChannelTasks = Agent Home 频道任务板（自治组队，额外吃 Web UI 设置开关）。
     * 注入进名单仍要过 isEnabled：专属表面（--serve / webUiAcp / job worker）
     * 再加上房间/频道 ACL。WorkBuddy `--acp` 过不了专属表面，模型看不见。
     *
     * Internal generator agents (compact, summaryGenerator, terminalTitleGenerator, ...)
     * run in isolation and never participate in team / room messaging — these tools
     * would only consume prompt tokens and, for structured-output agents like
     * `compact`, can pollute the model's response with off-topic tool descriptions.
     */
    protected maybeInjectSendMessage(agentName: string, effectiveTools: string[]): void;
    /**
     * Inject ExitPlanMode into the tool list of every non-main, non-internal agent.
     *
     * The tool's `isEnabled` check (see createIsEnabledChecker) gates visibility on
     * the session being in plan mode, so this injection is a no-op for sub-agents
     * running in normal modes — they simply never see the tool. When a sub-agent is
     * spawned with `mode: 'plan'`, ExitPlanMode becomes the agent's only escape
     * hatch back to the parent, completing the plan_approval protocol.
     *
     * Skipping the main agent: its tools[] is configured explicitly in product.json
     * and ExitPlanMode is already listed there — re-injecting would do nothing
     * useful and might mask config drift. Skipping internal generator agents
     * (compact, summary) for the same reason as SendMessage: they never run in
     * plan mode.
     */
    protected maybeInjectExitPlanMode(agentName: string, effectiveTools: string[]): void;
    /**
     * Check if a tool is disallowed by the owning session's effective permissions.
     *
     * A tool is only disabled in the model's tool list when there is a whole-tool
     * deny rule (e.g. `Bash`, with no subcommand scope). Scoped rules like
     * `Bash(pkill:*)` deny specific invocations — those are enforced at tool-execution
     * time by ToolPermissionService Phase 1, so the tool itself must remain available
     * to the model.
     */
    protected isToolDisallowed(session: Session, toolName: string, aliases: string[]): boolean;
    protected buildSessionAwareMcpServers(baseServers: MCPServer[]): MCPServer[];
    protected buildMcpServers(): Promise<MCPServer[]>;
    /**
     * 根据指定的 MCP 工具列表,构建需要的 MCP servers
     * @param mcpTools MCP 工具名称列表。除 `mcp__serverName__toolName` 精确名外，
     * 也接受服务器级形态 `mcp__serverName` / `mcp__serverName__*`（整台 server）。
     * 注意：全通配 `mcp__*` 在 allow 侧不匹配任何 server（与 CC 一致，仅 deny 侧生效）——
     * 它会被解析成 server 名 `*`（归一化后 `_`），不命中任何真实 server。
     */
    protected buildMcpServersForTools(mcpTools: string[]): Promise<MCPServer[]>;
    /**
     * 解析 MCP 工具名称
     * @param fullName 格式: mcp__serverName__toolName
     *
     * 已知限制（P3）：server 名本身含 `__` 时无法无歧义解析。非贪婪 `(.+?)`
     * 会把 `mcp__my__server` 解成 server=`my`/tool=`server`，而非 bare server
     * `my__server`（若存在 `my` server 会误连）。因此约定 MCP server 名不得含 `__`
     * （与 `mcp__server__tool` 分隔符冲突）；若确有此类 server，其工具无法经 tools
     * 白名单精确寻址。
     */
    private parseMcpToolName;
    /**
     * 获取 default agent 的 tools 配置
     * 用于未配置 tools 的 custom agent 继承
     */
    private getDefaultAgentTools;
    getAll(): Promise<Agent[]>;
    getAllConfigs(): Promise<ProductAgentConfiguration[]>;
    getCommands(agentName: string): Promise<Command[]>;
    /**
     * 根据 ID 或名称查找模型（仅按 ID/名称查找，不支持 variant type）
     */
    protected findModelByIdOrName(idOrName: string): LanguageModel | undefined;
    /**
     * Whether a non-default agent has no originally declared models
     * (only auto-appended custom/chat models, or nothing at all) and thus
     * should inherit the default agent's currently selected model.
     *
     * Mirrors the anti-contamination check in `getModels` (search for
     * `hasNonAutoAppendedModel`). Keep the two in sync.
     */
    protected shouldInheritDefaultAgentSelection(config?: {
        name?: string;
        models?: string[];
        tags?: string[];
        declaredModel?: string;
    }, findModel?: (idOrName: string) => LanguageModel | undefined): boolean;
    /**
     * 是否走"主 Agent 模型口径"：产品默认 agent + shipped 站立模式
     * ptc / minimal / create（tags 带 `main-mode`；multitask 见下方例外）。
     *
     * 主 Agent 的模型选择必须与默认 agent 同源（env CODEBUDDY_MODEL > settings.model）。
     * 历史洞（#110481 / #124922 / #125531）：站立模式由 buildModeAgents 从 cli
     * **拷贝** models 列表，`shouldInheritDefaultAgentSelection` 因列表非空返回 false，
     * 于是没有显式模型快照时 `computeModel` 落到"列表首项"——即"配了 A 实际跑 B"。
     *
     * 真声明了模型的配置（frontmatter `model:` → declaredModel 且非 inherit/default）
     * 保持自身声明，不参与继承。
     *
     * 作用面**有意**只含 ptc / minimal / create，不含 `multitask`（本判据无 session 上下文、
     * 无法感知 gate，而 multitask 在 unopted 宿主可达；保持其原有「列表首项」行为是 WB 零影响
     * 的必要条件，属已决口径，不是待办）。（`mainAgent: true` 自定义预设不在本
     * 判据内，但它们的 loader 产物在未声明 `model` 时 `models` 为空数组，本来就会经
     * `shouldInheritDefaultAgentSelection` 继承用户选择 —— 行为与改动前一致）：
     * 这两类在 unopted 宿主（WorkBuddy）可达，而本判据无 session 上下文、无法感知 gate——
     * - multitask：resolver 的协调器分支先于 gate 短路（main-agent-resolver.ts:309-318、
     *   331-340），`/multitask` 本地命令无 gate（multitask/slash-entry.ts），
     *   `settings.agent=multitask` 的盖章早于 gate 判定（main-agent-session.ts:625-632；native 形态。
     *   WB 走 ACP 时 session-middleware 对 body.acp 直接跳过，该路径在 WB 侧闭合）；
     * - 自定义预设：经 settings.agent / mention 可在 unopted 宿主成为 run agent。
     * 对 WB 的"零影响"要求下不扩大作用面；后续若做，需 session 级判据。
     */
    protected isMainAgentModelScope(agentName: string, config?: {
        name?: string;
        tags?: readonly string[];
        declaredModel?: string;
    }): boolean;
    /**
     * cbc-core `AgentManager.isMainAgentRun` 的实现：本轮 run 是否属于会话的主 Agent。
     *
     * 默认 agent、站立的 shipped 模式（ptc/minimal/create/multitask）与 `mainAgent: true` 自定义
     * 预设同视为主 Agent 运行 —— core 的压缩闸 / Stop hook 续跑据此按主 Agent 语义处理。
     *
     * 与模型口径 `isMainAgentModelScope` 的差异是有意的：本方法有 session 上下文（可读站立键 +
     * 门控）故覆盖 multitask；模型口径无 session 上下文、无法感知 gate，故排除 multitask。
     *
     * 门控：总闸关闭（WorkBuddy 等 unopted 宿主）时只认默认 agent，保持既有行为不变；
     * 无站立键时的 leftover run 名（telemetry 写入的临时身份）同样不认。
     */
    isMainAgentRun(session?: Session, runAgentName?: string): boolean;
    getModels(agentName: string): Promise<LanguageModel[]>;
    getInitializeMetadata(): Promise<InitializeMetadataSnapshot>;
    private isUsableInitializeMetadataSnapshot;
    /**
     * Once rebuild has published its runtime maps, they are the authoritative
     * Session model catalog. Reading them is gate-free here: `_ready` proves the
     * first rebuild settled, so this does not add MCP/rebuild latency to the
     * initialize fast path.
     */
    private repairInitializeMetadataFromRuntime;
    /**
     * initialize 握手元数据快照的**唯一**计算入口。见 `initializeMetadataPromise` 字段注释。
     *
     * 直接从 `productManager.waitConfiguration()` 的 raw agents/models 派生，不依赖
     * `agentConfigMap` / `modelMap` / `defaultAgentName`（那些要等 rebuildAgents
     * 走到 line ~942 才 populate）。settings.get('model') 与 env `CODEBUDDY_MODEL`
     * 是唯二异步依赖，它们与 waitConfiguration 并行。
     *
     * 失败静默降级为空快照，避免阻断 initialize 握手；rebuildAgents 完成后 SDK 侧
     * 再拉一次 initialize（或走 run 时的 getPrimaryModel）就能拿到完整数据。
     */
    private computeInitializeMetadataSnapshot;
    /**
     * currentModelId: env/settings selection > first enabled model. A selection
     * outside the advertised list remains trusted for compatibility; a known
     * disabled selection falls back to the first enabled model.
     */
    private resolveInitializeCurrentModelId;
    /**
     * `computeModels` 的**无状态**版本：只从传入的 raw agents/models 派生，
     * 不读 `agentConfigMap` / `modelMap`。供 initialize 元数据快照专用。
     *
     * 与 `computeModels` 保持行为一致：非 default agent 若只有 auto-appended
     * custom/chat 模型则继承 default；然后 append 所有 custom/chat 模型。
     */
    private computeModelsFromRaw;
    /**
     * `getModels` 去掉就绪等待后的纯计算部分（只读 `agentConfigMap` / `modelMap`）。
     * 供公开的 `getModels`（等 `readyDeferred`）与 `getInitializeMetadata`
     * （只等 `configReadyDeferred`，不等 MCP）复用。
     */
    private computeModels;
    getModel(agentName: string): Promise<LanguageModel>;
    /**
     * `getModel` 的 gate-free 变体（见 protocol 注释与 #84036）：
     * 直接调`computeModel`，不走任何就绪 gate；调用点在配置还没就绪时（例如
     * modelMap 为空）应容忍返回 undefined —— computeModel 内部找不到模型会
     * throw，这里 catch 掉，让render 上下文降级到无model 元数据即可。
     */
    getModelForContext(agentName: string): Promise<LanguageModel | undefined>;
    /** issue #84036:参见 `getModelForContext` 的说明。 */
    getModelsForContext(agentName: string): LanguageModel[];
    /**
     * agent 声明列表的第一位：`declaredModel` 优先（inherit/default 视为未声明），
     * 否则取 `models` 里第一个非变体项。
     */
    private resolveDeclaredModelHead;
    /**
     * 给模型选择器用的槽位 id：Auto 系（auto / auto-chat / 三档）与 `default-model*` 占位。
     * 它们不代表某个具体可调用的模型，不能当作「没配模型时跑什么」的依据。
     */
    private isModelSlotId;
    /**
     * `getModel` 去掉就绪等待后的纯计算部分（只读 config maps + settings + env）。
     * 供公开的 `getModel`（等 `readyDeferred`）与 `getInitializeMetadata`
     * （只等 `configReadyDeferred`）复用。内部递归/协作也全走 gate-free 版本。
     */
    private computeModel;
    getRelatedModel(primaryModelId: string, variantType: ModelVariantType): Promise<LanguageModel>;
    /**
     * `getRelatedModel` 去掉 `readyDeferred` 等待后的纯计算部分。供公开方法与
     * `computeModel`（initialize 元信息路径）复用，避免变体模型解析被 MCP 阻塞。
     */
    private computeRelatedModel;
    private computeBuiltinLiteModel;
    private resolveModelSpecificRelatedModel;
    private resolveDefaultRelatedModel;
    /**
     * 判断模型是否是自定义模型或外部模型
     * - 企业版模型
     * - 带有 custom 标签的模型（通过 models.json 添加）
     * - 带有自定义模型 id 前缀的模型
     */
    protected isCustomOrExternalModel(model: LanguageModel): boolean;
    protected isAutoAppendedModel(model: LanguageModel): boolean;
    /**
     * 从环境变量获取模型 ID
     * CODEBUDDY_SMALL_FAST_MODEL -> lite variant
     * CODEBUDDY_BIG_SLOW_MODEL -> reasoning variant
     */
    protected getModelIdFromEnv(variantType: ModelVariantType): string | undefined;
    resolveModel(modelStr: string, session?: Session): Promise<LanguageModel | undefined>;
    /**
     * 解析场景变体继承所需的"主模型"（Issue #82146）。
     *
     * 优先级：会话运行时态（session.requestOptions.model / session.options.model，
     * 即 /model 切换、--model 启动、ACP set_model 写入的会话级选择）>
     * 启动默认（getPrimaryModel：env CODEBUDDY_MODEL > settings > agent 默认）。
     */
    protected resolveSessionPrimaryModel(session?: Session): Promise<LanguageModel>;
    /**
     * 解析配置级 model（来自 slash command / skill / subagent 工具参数或 agent config models[0]）。
     *
     * CodeBuddy 特有的生态兼容语义：当配置的模型不在本地可用列表中（如 Claude Code 生态 agent
     * 写 `model: opus` / `claude-opus-4`，或命中 disabled 模型），**降级为继承主对话当前模型**，
     * 而不是把 CodeBuddy 后端不认识的字符串直接发出去（会报错）。返回 undefined 表示"未解析出
     * 可用模型"，由调用方回退到会话级继承。
     *
     * 为什么返回 undefined 而不是当场取 `getModel(defaultAgent)` 的 id：`getModel` 没有 session
     * 参数，只读 `CODEBUDDY_MODEL` env + 全局 settings，读不到会话级 set_model / ACP 切模型 override，
     * 命中时会退到 agent models[] 列表首项。返回 undefined 后各调用方回到自己的会话级解析：
     * subagent/skill-fork 走 `AgentTask.resolveAgentModel` + 建 session 时继承
     * `mainSession.requestOptions.model`；command/inline-skill 有 `if (resolvedModel)` 守卫，
     * undefined 时不覆盖 requestOptions.model，同样落到主对话模型。
     *
     * @param requestedModel 要解析的 model id / name / variant（'lite' / 'builtin-lite' / 'reasoning' / 具体模型字符串）
     * @param sourceLabel 日志来源标签，如 `command:/review-pr` / `skill:my-skill` / `subagent:Explore`
     * @param session 可选会话上下文；解析 variant 时保持与当前 session 主模型一致
     * @returns 已知且启用的模型 id；入参为空、本地查不到或命中 disabled 时返回 undefined
     *          （调用方据此继承主对话当前模型）
     */
    resolveConfiguredModelOrFallback(requestedModel: string | undefined, sourceLabel: string, session?: Session): Promise<string | undefined>;
    /**
     * 判断字符串是否表示「继承 / 回落默认编排」（'inherit' / 'default' / 空）。
     * 与 AgentTask.isInheritedModel 语义保持一致。
     */
    protected isInheritModelValue(value: string | undefined): boolean;
    /**
     * 读取 settings.subagents.agents[agentName].model，并区分该值来自项目级还是全局级
     * （用于面板 SOURCE 列）。返回 undefined 表示未配置或配置为 inherit/default。
     *
     * 合并语义：settings-manager 已把 subagents 登记进 mergeBySubKeySettings，
     * 因此 list()（不带 scope）返回的是各 scope 按 agent key 递归合并后的结果。这里额外单独
     * 读 PROJECT / PROJECT_LOCAL scope，用于判定某个 agent 的值究竟来自项目还是全局。
     */
    protected getSubagentModelFromSettings(agentName: string): Promise<{
        value: string;
        source: 'settings-project' | 'settings-user';
    } | undefined>;
    /**
     * 检查项目级 scope（PROJECT / PROJECT_LOCAL）是否对某个 agent 配了非 inherit 的模型。
     * 用于区分「生效来源」是项目级还是全局级。读取失败按「无项目级配置」处理。
     */
    protected readSubagentModelFromProjectScopes(agentName: string): Promise<boolean>;
    /**
     * 读取 settings.variantModels[variant]（合并视图，项目级已覆盖全局级）。
     * 返回 undefined 表示未配置或值为空。仅供能力 B 使用。
     */
    protected getVariantModelFromSettings(variant: ModelVariantType): Promise<string | undefined>;
    /**
     * 判断变体来源来自项目级还是全局级 settings（用于面板 SOURCE 列）。
     */
    protected readVariantModelFromProjectScopes(variant: ModelVariantType): Promise<boolean>;
    resolveEffectiveSubagentModel(agentName: string, explicitModel?: string, session?: Session): Promise<EffectiveModelResolution>;
    /**
     * 把一个非 inherit 的模型值（可能是变体名 / id / 别名）解析为「生效模型 + 来源」。
     * 命中禁用 / 本地未知时降级为 fallback-main（继承主模型）。
     *
     * @param value        要解析的模型值
     * @param source       命中时使用的来源标签
     * @param inheritResult 主模型继承结果（禁用/未知时降级用；其 modelId 为主模型 id）
     * @param displayId    面板展示用的 modelId（通常等于 value，如变体名 "lite"）
     * @param session      发起调用的会话；变体名按该会话当前模型解析（Issue #149675）
     */
    protected resolveNonInheritModelValue(value: string, source: EffectiveModelSource, inheritResult: EffectiveModelResolution, displayId: string, session?: Session): Promise<EffectiveModelResolution>;
    resolveEffectiveVariantModel(variant: ModelVariantType, session?: Session): Promise<EffectiveModelResolution>;
    /**
     * 在 instructions 末尾拼接 agent 级持久记忆段落。
     *
     * 每次求值时重建，保证每次 spawn 读到最新的 MEMORY.md；构建失败降级为无记忆
     * 段落，不影响 agent 可用性。主 agent 分支与通用分支共用本方法，避免两条
     * 路径各写一份、其中一条漏掉记忆（曾经就是这样丢过 shipped 模式的记忆段落）。
     *
     * 本方法是 system prompt 的最终出口：单模板产物已由 DefaultPromptRenderer 收敛过
     * 空行，但记忆段落（MEMORY.md 原文）、codeMode 改写、append 指令都不经模板渲染，
     * 这里再收敛一次（#102340）。
     */
    protected appendAgentMemoryPrompt(instructions: string, agentName: string, memoryActive: boolean, memoryScope: AgentMemoryScope | undefined): Promise<string>;
    protected renderDefaultAgentInstructions(config: ProductAgentConfiguration, context: Record<string, unknown>, session?: Session): Promise<string>;
    /**
     * Fill the {{PluginAgentPrompt}} slot in a host-supplied system prompt with
     * the resolved plugin/expert persona (empty string when none resolves), then
     * return it; a prompt without the slot is returned verbatim. Shared by the
     * session-override and CLI-override branches so both fill identically.
     */
    private fillPluginAgentPromptSlot;
    /**
     * Per-session system-prompt override (served QueryOptions.systemPrompt),
     * applied only to a genuine main-turn agent — subagent sessions and internal
     * generator agents (compaction / titles / classifiers) keep their own
     * prompts. Returns the replace-base, or undefined when unset / not eligible.
     * The append form is layered separately (applySessionSystemPromptAppend) so
     * the append-only case still renders the product default as its base.
     */
    protected getSessionSystemPromptOverride(session: Session | undefined, agentName: string): string | undefined;
    /** Layer the per-session appendSystemPrompt (served) after any base; main-turn only. */
    protected applySessionSystemPromptAppend(base: string, session: Session | undefined, agentName: string): string;
    /** 档案级系统提示词（见 session-profile-prompt），与会话级覆盖同一套主轮门控。 */
    protected getSessionProfilePromptText(session: Session | undefined, agentName: string, mode: 'append' | 'replace'): string | undefined;
    private isSessionPromptOverrideEligible;
    /**
     * Served `QueryOptions.promptContext` as render defaults for the main turn:
     * only primitive values under keys the CLI prompt context does not produce,
     * so CLI-produced keys keep their own values (the `--prompt-vars-file`
     * no-overwrite rule) and explicit render context is spread after these.
     */
    private resolveHostPromptDefaults;
    /**
     * Resolve host --system-prompt / --system-prompt-file (+ optional append) for the default agent.
     * Returns undefined when the host did not supply a CLI system-prompt override.
     */
    protected getCliSystemPromptOverride(): string | undefined;
    protected renderPluginAgentPrompt(config: ProductAgentConfiguration, session?: Session): Promise<string | undefined>;
    protected hasPluginAgentPromptPlaceholder(instructions: string | undefined): boolean;
    getCliDescriptionAndOutputStyle(session?: Session): Promise<{
        cliDescriptionContent?: string;
        outputStyleContent?: string;
        keepCodingInstructions?: boolean;
    }>;
    /**
     * 应用插件 settings.agent 配置
     *
     * 逻辑参考 Claude Code (main.tsx:2055-2062, settingsCache.ts):
     * - plugin settings 作为最低优先级 base layer
     * - 从启用插件的 settings.agent 中获取 agent 名称
     * - 仅当该 agent 在已注册的 agents 或 plugin components 中存在时才生效
     * - CLI flag (--agents) 和用户 settings 优先级更高（会覆盖）
     *
     * @param availableAgents 当前可用的 agent 配置列表
     */
    private applyPluginAgentSetting;
    private applyReplacePluginAgentBaseBeforeVolatile;
    private syncDefaultAgentMcpToolWhitelist;
    private normalizeMcpWhitelistToolNames;
    /**
     * Register all agents declared by a plugin (lead + members) so that they
     * can be resolved by name via agentManager.get(name). This is required for
     * team experts whose members are invoked through the Agent tool with
     * `subagent_type=<memberName>`: AgentTask.setupPhase() calls
     * agentManager.get(subagent_type) and throws "Task agent <name> is not
     * available" if the name is missing from the registry.
     *
     * Side effects:
     *   - Appends new configs to `availableAgents` (so the subsequent
     *     Promise.all(registerAgent) batch in buildAgentsFromProductConfiguration
     *     picks them up and writes them into agentMap).
     *   - Writes each config into agentConfigMap immediately (mirrors how
     *     buildAgentsFromProductConfiguration seeds product agents at line ~376,
     *     so any code that queries agentConfigMap before registerAgent finishes
     *     still sees the plugin agents).
     *
     * Failure isolation: logs and skips on per-agent errors; never throws.
     * Name conflicts with already-registered agents (either built-in or an
     * earlier plugin) are skipped with a warn log to avoid overwriting trusted
     * product-level definitions.
     *
     * Non-goals: does NOT change how the lead is patched onto the default
     * agent, and is a no-op when the matched plugin exposes no agents or when
     * matchedPlugin is undefined.
     */
    private registerPluginAgents;
    /**
     * Remove plugin settings.agent roots from every standalone registry after
     * CLI/user agent resolution. They remain usable as the default agent's
     * configuration source, while plugin member agents stay callable.
     */
    private removePluginSettingAgentsFromStandaloneRegistry;
    /**
     * 应用 settings.json 的 agent 配置
     *
     * 优先级高于 plugin agent，低于 CLI --agent 参数。
     * 参考 Claude Code (main.tsx:2054-2058):
     *   const agentSetting = agentCli ?? getInitialSettings().agent;
     *
     * @param availableAgents 当前可用的 agent 配置列表
     */
    private applySettingsAgent;
    /**
     * 等待 rebuild 进入稳定态（既不在 rebuilding、也没有挂起的 pendingRebuild）。
     */
    refreshAgents(): Promise<void>;
    waitForRebuildSettled(timeoutMs?: number): Promise<void>;
    trackPendingInitializeOverride(promise: Promise<void>): void;
    /**
     * 在 run 入口（`get` / `getDefault`）await 后台初始化覆盖链的当前尾部。
     * 覆盖动作自身失败不阻断 run —— 覆盖失败只意味着这次 initialize 的 systemPrompt /
     * agents 没生效，CLI 仍应能继续跑（对齐 `applySdkInitializeOverrides` 的 swallow 语义）。
     */
    protected awaitPendingInitializeOverride(): Promise<void>;
    protected getInstructionFingerprint(instructions?: string): string;
    protected buildAgentConfigFingerprint(agents: ProductAgentConfiguration[]): string;
    /**
     * 构造 skills 的指纹字符串,用于判断是否需要 rebuild agent。
     *
     * 必须包含可见性 flag (disableModelInvocation / userInvocable):
     * toggle 这两个 flag 时 skill.name 不变,若指纹只含 name 会判为"配置未变化"跳过 rebuild,
     * 导致工具描述缓存不失效、模型上下文展示旧状态。见 issue #67209。
     *
     * 必须包含 description / displayName:
     * description 影响模型上下文展示内容,displayName 影响 tool-manager 的 builtin 压制 +
     * SkillTool.findSkill 的名称解析。单独改这两个字段不触发 rebuild 会导致提示词与执行不一致。
     * 用 length+前缀压缩(同 getInstructionFingerprint),避免长 description 让指纹膨胀。
     */
    /**
     * 首次构建缓存快速路径的空视图判据：产品配置里是否已含至少一个可用的 CLI agent
     * （带 {@link CLI_AGENT_TAG} tag，与下方 `filteredAgents` 过滤口径一致）。
     *
     * 为 true 时说明缓存快照足以发布出非空的 agent 视图、getDefault() 不会崩溃，
     * 首次构建无需回退等 product 完整 sync；为 false（全新环境/无缓存）才回退。
     */
    protected static hasUsableCliAgent(config: {
        agents?: ProductAgentConfiguration[];
    }): boolean;
    /**
     * 首次构建能否直接用缓存视图：要有可用的 CLI agent，且 `--agent` 指定的人设已在视图里
     * （内置 ptc/minimal/create 由 ensureShippedModeAgents 补齐）。缓存里没有的自定义 /
     * 插件 agent 仍等完整 sync，避免首轮用错人设。
     */
    protected static firstBuildNeedsFullSync(config: {
        agents?: ProductAgentConfiguration[];
    }, cliAgent: unknown): boolean;
    protected static buildSkillsFingerprint(skills: {
        name: string;
        disableModelInvocation?: boolean;
        userInvocable?: boolean;
        description?: string;
        displayName?: string;
    }[]): string;
    protected normalizePluginAgentSetting(rawSetting: unknown): string | undefined;
    protected normalizePluginRequestHeaders(headers: unknown): Record<string, string> | undefined;
    protected stringifyPluginRequestHeaders(headers: Record<string, string> | undefined): string;
    protected parseVolatilePluginSource(pluginId?: string): {
        name: string;
        marketplaceName: string;
    } | undefined;
    protected getPluginAgentSetting(components: {
        settings?: {
            agent?: unknown;
        };
    } | undefined): string | undefined;
    protected getPluginAgentFingerprint(): Promise<string>;
}
export {};
