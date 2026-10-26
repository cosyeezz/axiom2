import { type CanUseTool, Session } from '../../vendor/cbc-core/node/index.js';
import type { Agent, Command, SecurityReviewConfigEnvelope, Skill } from '@genie/product';
import { Effect, Fiber, Queue } from 'effect';
import { type DataFs } from '../data-fs';
import { type HostElicitation } from '../elicitation/session-elicitation';
import type { McpConfig } from '../mcp/mcp-protocol';
import { type Sandbox } from '../sandbox/sandbox';
import type { Settings } from '../settings/settings-protocol';
import { KernelOperationError } from './kernel-effects';
import { SessionManager, Settings as SettingsService } from './services';
import { type FormattedSessionEvent, type QueryOptions, type ReloadOptions, type SessionEvent, type SessionEventListener, type SessionKey, type SessionOutputFormat, type SessionSourceEvent, type SessionStore, type SessionStoreEntry, type SessionSubscription, type SessionSubscriptionExit, type SteerOptions, type SteerResult } from './types';
export interface StoreContext {
    store?: SessionStore;
    projectKey?: string;
}
/**
 * Frames a single listener may lag behind before it is evicted. The bound is
 * a lag deficit, not a throughput cap: a draining listener holds at most a
 * handful of frames, so reaching it means the consumer is hung or persistently
 * slower than production. Eviction turns silent unbounded buffering into an
 * explicit signal — the host re-subscribes and catches up from the store.
 * A synchronous same-task burst counts fully against the mark (drain only
 * advances between tasks); kernel producers emit one task per combine event,
 * so real bursts stay far below it.
 */
export declare const LISTENER_QUEUE_HIGH_WATER_MARK = 4096;
/**
 * 每次 fiber 唤醒最多随手泄洪的积压帧数。有效驱逐滞后 ≈ HWM + 本批在手帧
 * （first + backlog），上限收小让阈值贴近 HWM。
 */
export declare const DELIVERY_DRAIN_CHUNK = 256;
/**
 * 每 listener 一条投递流（E7''）：bounded Queue（dropping 策略）+ 常驻 drain
 * fiber。offer 满即 false → 驱逐该 listener（原高水位驱逐语义等价）；退订/
 * 驱逐 = queue shutdown → take 失败 → fiber 自然收场。惰性物化：subscribe
 * 可先于 boot（纯登记），首次 push（必在 runtime armed 后）才建 queue/fiber。
 */
interface ListenerChannel {
    queue?: Queue.Queue<SessionSourceEvent>;
    format: SessionOutputFormat;
    deliver: (event: SessionSourceEvent) => Promise<void>;
    fiber?: Fiber.Fiber<void, never>;
    produced: number;
    delivered: number;
    exit?: SessionSubscriptionExit;
    finish: (exit: SessionSubscriptionExit) => void;
    waiters: Array<{
        target: number;
        resolve: () => void;
        reject: (error: unknown) => void;
    }>;
}
/** 会话运行队列条目：执行体 + ticket 的 promise 接线。 */
interface QueuedRun {
    execute: () => Promise<void>;
    reject: (error: unknown) => void;
}
export interface LiveEntry {
    id: string;
    session?: Session;
    listeners: Map<SessionEventListener, ListenerChannel>;
    wiring: Array<{
        unsubscribe(): void;
    }>;
    opening?: Promise<Session>;
    /** FIFO 运行队列（E7''）：同会话 query 严格按序、失败不阻后继。 */
    runQueue?: Queue.Queue<QueuedRun>;
    runWorker?: Fiber.Fiber<void, never>;
    /** 在途 + 排队 run 计数（entry 驱逐判据之一）。 */
    pendingRuns: number;
    /** 最近 run 活动时刻（enqueue 与 settle 更新）——空闲清扫判据。 */
    lastActivity: number;
    /** Latest query settlement, awaited by interrupt() for its semantic ack. */
    activeSettle?: Promise<unknown>;
    /**
     * runId marked by interrupt(). The stop-reason source of truth: the
     * kernel's cancel recovery replaces session.abortController at run entry,
     * so the signal read after settle can report a fresh, unaborted state.
     */
    interruptedRunId?: string;
    activeRunId?: string;
    /** Claimed query identities for this residency; evicted with this entry. */
    requestIds?: Set<string>;
    acceptSteer?: (input: string | unknown[], options: SteerOptions) => Promise<SteerResult>;
    closing?: boolean;
    cwd?: string;
    /** Activation-scoped: resolved once per activation, never merged per query. */
    sandbox?: Sandbox;
    /** Activation-scoped session-tier user-data fs (QueryOptions.fs adapter). */
    dataFs?: DataFs;
    /** Activation-scoped session-tier settings snapshot (QueryOptions.settings). */
    sessionSettings?: Settings;
    settingSources?: QueryOptions['settingSources'];
    /** Mutable response language overlays the activation settings, never shared CLI settings. */
    languageOverride?: QueryOptions['language'];
    /** Coalesced host request, consumed only at the next execution boundary. */
    pendingReload?: ReloadOptions;
    /** Transient next-turn policy. null explicitly clears an invalid prior choice. */
    securityReviewConfig?: SecurityReviewConfigEnvelope | null;
    /**
     * 会话档 settings 是否已由宿主显式提供。缺席时挂的是 server 默认底
     * （可被后续首个带 settings 的 query 升格替换）；置位后按激活期定型
     * 规则不再变更。
     */
    sessionSettingsFromHost?: boolean;
    /** Set once the session-tier MCP servers (QueryOptions.mcpServers) bound. */
    sessionMcp?: boolean;
    /**
     * 会话级 MCP 装配签名（server 名 + config 指纹 + instance 身份/工具定义
     * 内容签名）。每刷比对：变更即卸旧重挂——消除"首刷定型、后续静默忽略"
     * 的正确性缺口（与 tools 白名单的每刷合并语义拉齐）。
     */
    sessionMcpSig?: string;
    sessionMcpDirty?: boolean;
    /** 会话档技能（形态 A）：激活期从会话 fs 扫描，钝化清除。 */
    sessionSkills?: Skill[];
    /** 会话档命令（形态 A，与技能同构）：激活期从会话 fs 扫描，钝化清除。 */
    sessionCommands?: Command[];
    /**
     * 会话档专家插件已解析标记（#108461）：激活期用标准加载器（loadPluginComponents）
     * 全量加载会话 fs 里已启用（settings.enabledPlugins）的插件一次，persona 写入
     * session-plugin-agent seam，MCP/skills/commands 存入下列 entry 字段供各会话车道
     * 合并。任一组件都可为空，故用布尔标记而非值判在场；钝化清除。
     */
    sessionPluginsMounted?: boolean;
    /** The session-only plugin roots the mounted plugin set was resolved with (QueryOptions.pluginRoots). */
    pluginRoots?: QueryOptions['pluginRoots'];
    /** 会话档插件贡献的 MCP servers（并入 mountSessionMcp 的会话 MCP 车道）。 */
    pluginMcpServers?: Record<string, McpConfig>;
    /**
     * QueryOptions.strictMcpConfig，激活期绑定、reload 替换、钝化清除：置位时插件声明的
     * MCP 不进会话 MCP 车道，并写进会话 options，子代理的 agent 级 MCP 按同一开关取舍。
     */
    strictMcpConfig?: boolean;
    /** 会话档插件贡献的 skills（并入 mountSessionSkills 的会话 skills seam）。 */
    pluginSkills?: Skill[];
    /** 会话档插件贡献的 commands（并入 mountSessionCommands 的会话 commands seam）。 */
    pluginCommands?: Command[];
    pluginAgents?: Agent[];
    sessionDiscoveredAgents?: Agent[];
    sessionAgentsScanned?: boolean;
    hostAgentDefinitions?: QueryOptions['agents'];
    /**
     * 会话档自定义 agent 定义（QueryOptions.agents，#108461 D6）已绑定标记：首个带
     * agents 的 query 绑定驻留期（同 mcp/settings 的激活期定型），转换后的配置写入
     * session-agents seam；钝化清除。空 agents 不置位、留待后续 query 首供。
     */
    sessionAgentsMounted?: boolean;
    /** Activation-scoped permission callback (QueryOptions.canUseTool, SDK 同形). */
    canUseTool?: CanUseTool;
    /** Activation-scoped Host elicitation channel (QueryOptions.elicitation). */
    elicitation?: HostElicitation;
}
export declare class LiveSessionManager {
    private readonly entries;
    /** SessionStart emitted per residency; closing that residency emits SessionEnd. */
    private readonly sessionStarts;
    /** A failed passivation must not silently authorize a new runtime. */
    assertReleased(): void;
    /**
     * 时间读点单源（DST 判据）：runtime 已 bind 时走 Effect Clock——测试并入
     * TestClock 层即可在虚拟时间轴上推进空闲清扫；未 bind（boot 前 subscribe
     * 兼容道）兜底真时钟，彼时不存在清扫语义。
     */
    private nowMs;
    entry(sessionId: string): LiveEntry;
    /** Register an independently bounded listener, with an explicit delivery barrier. */
    addListener<F extends SessionOutputFormat = 'messages'>(sessionId: string, listener: (event: FormattedSessionEvent<F>) => void | Promise<void>, format?: F): SessionSubscription;
    /** queue shutdown → drain fiber take 失败自然收场（stop 后 runtime 已释放则静默）。 */
    private shutdownChannel;
    /** 首次 push 时物化投递流（subscribe 可先于 boot；push 必在 runtime armed 后）。 */
    private materializeChannel;
    /** Execution ownership, including queued continuations, outlives ACP foreground idle. */
    hasWork(sessionId: string): boolean;
    peekSession(sessionId: string): Session | undefined;
    reload(sessionId: string, options: ReloadOptions): void;
    /** Configure a dormant or resident session without starting a turn. */
    setSecurityReviewConfig(sessionId: string, rawConfig: unknown): Promise<SecurityReviewConfigEnvelope>;
    /** Get-or-activate: resident wins, then local transcript, then store, then fresh. */
    activate(sessionId: string, options: QueryOptions, storeCtx: StoreContext): Effect.Effect<Session, unknown, import("./services").ComponentResolver | import("./services").AgentManager | import("./services").Product | SettingsService | import("./services").ToolPermission | import("./services").AgentScopedMcp | SessionManager | import("./services").Telemetry | import("./services").SkillScanner | import("./services").AgentScanner>;
    /** Prepare on an unregistered context, then publish one component snapshot. */
    private reloadComponents;
    /**
     * Sandbox and cwd bind on the first query that provides them and stay for
     * the residency: omission never unloads, replacement waits for a
     * passivate/activate cycle. cwd precedence: explicit query cwd, then the
     * sandbox default, then process.cwd().
     */
    private mountSandbox;
    /** A detached context shares activation's loaders without mounting execution resources. */
    readCatalog(session: Session, options: QueryOptions): Effect.Effect<import("./types").SessionCatalog, KernelOperationError, import("./services").ComponentResolver | import("./services").AgentManager | import("./services").Product | SettingsService | import("./services").ToolPermission | import("./services").Telemetry | import("./services").SkillScanner | import("./services").AgentScanner>;
    /**
     * Session-tier user-data fs: same activation-scoped rules as the sandbox —
     * the first query that provides it binds it for the residency, omission
     * never unloads, replacement takes a passivate/activate cycle.
     */
    private mountDataFs;
    /**
     * Session-tier settings: same activation-scoped rules as the sandbox — the
     * first query that provides them binds for the residency, omission never
     * unloads, replacement takes a passivate/activate cycle. Binding onto an
     * already-seeded resident session re-runs the permission-context seeding
     * so the rule buckets stay in step with the merged read.
     */
    /**
     * 交互回调（QueryOptions.canUseTool 与 elicitation）：激活期绑定，同 settings
     * 判例——首供绑定驻留期、省略不卸载、置换走钝化/激活。
     */
    private mountInteractionCallbacks;
    private mountSessionSettings;
    /**
     * Session-tier MCP servers: same activation-scoped rules as the sandbox —
     * the first query that provides them binds for the residency, omission
     * never unloads, replacement takes a passivate/activate cycle. Rides the
     * kernel's agent-scoped MCP lane: isolated clients outside the
     * process-global registries; the run-time merge shadows same-name global
     * servers for this session only. A setup failure (no usable server)
     * rejects this query and leaves the slot unclaimed so a later query can
     * retry.
     */
    /**
     * 会话档技能：query({ fs }) 命名空间里项目、用户等来源的
     * 技能随会话生效（清单与执行两读取点同名遮蔽进程档）。扫描失败不阻断
     * 激活（技能面 best-effort）。
     */
    private mountSessionSkills;
    /** 会话档命令（形态 A）：与 mountSessionSkills 同构，best-effort + 告警。 */
    private mountSessionCommands;
    /**
     * 会话档专家插件（#108461，与 mountSessionSkills 同构）：激活期用**标准加载器**
     * （loadPluginComponents，会话 rootScope 内 ambient dataFs + currentSessionSettings）
     * 全量加载会话 fs 里已启用（settings.enabledPlugins）的 ~/.codebuddy/plugins 插件一次：
     * settings.agent 的组合配置写入 session-plugin-agent（persona 槽与工具声明），
     * MCP/skills/commands 存入 entry 供 mountSessionMcp/Skills/Commands 合并（故本函数须先于
     * 三者执行）。任一组件都可为空，故用 sessionPluginsMounted 标记而非值判在场。解析
     * 失败不阻断激活但必须告警——静默吞会让"专家不可用"零线索（lamp 判例）。
     */
    private mountSessionPlugins;
    /**
     * session-agent-view 预热（激活期构建一次）：会话档输入就位后构建默认 agent
     * 的会话视图，首轮派发命中缓存。失败降级到派发期兜底构建，不阻断激活。
     */
    private warmSessionAgentView;
    /**
     * 会话档自定义 agent 定义（QueryOptions.agents，#108461 D6）：首个带 agents 的
     * query 转换并绑定驻留期（同 mcp/settings 激活期定型），写入 session-agents seam
     * → 可被 QueryOptions.agent 选为主席位、也可作为 subagent 派发。转换失败/无效
     * 定义 best-effort 告警，不阻断激活。
     */
    private mountSessionAgents;
    private mountSessionMcp;
    private open;
    /** Per-query options merge, mirroring the per-request merge bin requests get. */
    private applyOptions;
    /** applyOptions 的同步部分：无内核依赖的 options 归并与席位写入。 */
    private applyStaticOptions;
    /**
     * Route native facts to each format. The messages converter keeps its
     * stream state even across subscription gaps; delivery remains demand-driven.
     */
    private wire;
    private hasAudience;
    push(entry: LiveEntry, event: SessionSourceEvent, audience?: 'all' | 'messages' | 'native' | 'acp' | 'openai'): void;
    hasMessageListeners(sessionId: string): boolean;
    pushNativeTo(sessionId: string, event: import('./types').NativeSessionEvent): void;
    pushTo(sessionId: string, event: SessionEvent): void;
    private evict;
    /**
     * 会话运行队列（E7''）：严格 FIFO、失败不阻后继——Effect Queue + 单
     * worker fiber 承接（原 promise chain 语义逐字等价）。ticket 的 promise
     * 在 enqueue 时建好，worker settle 时接线。
     */
    enqueueRun<A>(sessionId: string, execute: () => Promise<A>): Promise<A>;
    private ensureRunWorker;
    private lastIdleSweepAt;
    /**
     * 空闲会话清扫（cloud 现实防护：宿主忘 close）。活动搭车触发（runQuery
     * 每次调用，内部按 min(idleMs/4, 60s) 节流）——无常驻定时器，不阻进程
     * 退出；空闲 pod 内存静态无增长，语义自洽。钝化 ≡ close（镜像落 store、
     * 内核在存释放、listener 存活、重触达水合），fork 执行不延迟当前 query。
     */
    scheduleIdleSweep(storeCtx: StoreContext, idleTimeoutMs: number): void;
    /**
     * entry 驱逐（soak 残留修复的 LSM 半边）：钝化后无 listener、无在途/排队
     * run 即逐出——queue shutdown 使 worker 自然收场；下次触达按需重建。
     */
    private maybeEvictEntry;
    keyFor(sessionId: string, entry: LiveEntry, storeCtx: StoreContext): SessionKey;
    noteSessionStart(session: Session, started: Promise<void>): void;
    /**
     * SessionEnd for a residency that emitted SessionStart, as a CLI process
     * exit runs it: reason `other`, in the session's settings, directory and
     * sandbox, after its runs settled. Closing waits no longer than the CLI's
     * exit deadline; the hooks keep their own timeouts.
     */
    private endSession;
    /** Passivate: tear down kernel wiring. Listeners survive. */
    passivate(sessionId: string, storeCtx: StoreContext, idleTimeoutMs?: number): Effect.Effect<void, never, import("./services").ComponentResolver | import("./services").AgentScopedMcp | SessionManager | import("./services").Telemetry>;
    closeAll(storeCtx: StoreContext): Effect.Effect<void, never, import("./services").ComponentResolver | import("./services").AgentScopedMcp | SessionManager | import("./services").Telemetry>;
}
export declare const liveSessions: LiveSessionManager;
/**
 * Complete lane stores own the active branch, including an explicitly empty
 * branch after rewind. Only older stores without getLane use the progressive
 * loadLane/full-journal fallback. A failed authoritative read must not resurrect
 * abandoned history.
 */
export declare function hydrateStoreEntries(store: SessionStore, key: SessionKey): Promise<SessionStoreEntry[]>;
export {};
