/**
 * GalileoServiceImpl — @tencent/galileo-node-sdk 封装
 *
 * 生命周期：
 *   initialize() — 同步；普通启动立即检查环境变量，prewarm standby 延后到 activate
 *   onStart()    — 异步但**不阻塞**：将 SDK 初始化存为后台 promise（fire-and-forget），
 *                  不 await，避免阻塞 CellJS ApplicationLifecycle 串行链路
 *                  （串行 await 会推迟 HTTP Server listen → 推迟 ACP Server 就绪 → 阻塞会话打开）
 *
 * 降级策略：SDK 加载/初始化失败时全链路降级为 noop，不影响 CLI 主逻辑。
 * 关闭方式：设 DISABLE_GALILEO=1 环境变量。
 */
import { Application, ApplicationLifecycle } from '@celljs/core';
import { AuthenticationManager } from '@genie/authentication';
import { ClientInfoProvider, ProductManager } from '@genie/product';
import { Logger, type SpanProcessor, TracerProvider } from '@genie/telemetry';
import { type IPrewarmStateService } from '../prewarm/prewarm-protocol';
import { GalileoService } from './galileo-protocol';
/**
 * 给每个 span 打上 `env` 属性：SDK 在 Production 下把 resource 环境名强制为 formal，
 * 预发 trace 只能靠 span 属性区分。仅在配置了 envName 时挂载。
 */
export declare class GalileoEnvSpanProcessor implements SpanProcessor {
    private readonly envName;
    constructor(envName: string);
    onStart(span: Parameters<SpanProcessor['onStart']>[0]): void;
    onEnd(): void;
    forceFlush(): Promise<void>;
    shutdown(): Promise<void>;
}
export declare function isGalileoOtlpRequest(input: unknown, galileoHostname: string): boolean;
export declare class GalileoServiceImpl implements GalileoService, ApplicationLifecycle<Application> {
    protected readonly logger: Logger;
    protected readonly productManager: ProductManager;
    protected readonly clientInfoProvider: ClientInfoProvider | undefined;
    protected readonly authenticationManager: AuthenticationManager | undefined;
    protected readonly tracerProvider: TracerProvider | undefined;
    protected readonly prewarmState?: IPrewarmStateService;
    private ready;
    private meter;
    private galileoLogger;
    private tracer;
    private startupSpan;
    private otelMeterProvider;
    private otelTracerProvider;
    private otelLoggerProvider;
    private shutdownPromise;
    private histograms;
    private counters;
    private authSubscription;
    private productConfigDisposable;
    private galileoFingerprint;
    /**
     * 同步初始化 — 检查环境变量后 fire-and-forget 启动 SDK 初始化。
     * prewarm standby 期延后整个判定，避免读取 activate merge 前的环境。
     */
    initialize(): void;
    private _initializationStarted;
    private _activationDeferred;
    private _shouldInit;
    private _ValueType;
    /** 后台初始化 promise — forceFlush/shutdown 会 await 它确保初始化完成再操作 */
    private _initPromise;
    /** 标记 onStop 已被调用，防止 doInit 后台跑完后再 subscribe（竞态保护） */
    private _stopped;
    /**
     * 异步生命周期钩子 — **不阻塞**框架启动。
     *
     * 将实际 SDK 初始化存为后台 promise（fire-and-forget）：
     * CellJS AbstractApplication.doStart() 串行 await 每个 lifecycle.onStart()，
     * 如果这里 await waitConfiguration / SetupGalileo，会推迟 HTTP Server listen，
     * 进而推迟 ACP Server 就绪，阻塞 IDE 会话打开。
     */
    onStart(): Promise<void>;
    /**
     * 后台初始化 — 读取 product.json 顶层 Galileo.enable 开关，按需启动 SDK。
     * 任何异常都降级为 noop，不影响主流程。
     */
    private doInit;
    /**
     * 读取 Galileo 配置：统一走 @genie/product 的 resolveEffectiveGalileoConfig（与 trace-provider 同一判定），
     * 运行时 live 传 `process.env`，兼容 prewarm activate 后 merge 的环境。
     * 环境变量存在时不读 product 配置。
     */
    private readGalileoConfig;
    onStop(): void;
    private _patchName;
    private _clientVersion;
    private _uid;
    /** 配置了 envName 时写入日志属性 / metric 维度 / span 属性的 `env`；未配置时不注入（桌面端不变）。 */
    private _envName;
    private _gpuModel;
    private _gpuVram;
    private doSetup;
    recordDuration(metric: string, durationMs: number, dimensions?: Record<string, string>): void;
    addCounter(metric: string, count: number, dimensions?: Record<string, string>): void;
    /**
     * SDK 的 ExtAttributes 类型定义为 `{ [key: string]: string }`，
     * 把 number/boolean/null/undefined 统一转成 string，避免被 SDK 内部序列化静默丢弃字段。
     */
    private normalizeAttributes;
    logInfo(message: string, attributes?: Record<string, string | number | boolean>): void;
    logError(message: string, attributes?: Record<string, string | number | boolean>): void;
    isReady(): boolean;
    waitReady(timeoutMs?: number): Promise<void>;
    /**
     * 等待 galileo SDK 初始化完成（含 AgentLens primary 双报通道挂载）。
     *
     * 非交互快速进程（`-p` / stream-json）在 SDK 就绪前开始 agent run 时，
     * 业务 span 会因 OTel ProxyTracer 未代理到真实 provider 而变成 NonRecordingSpan
     * 整体丢失（Issue #83191）。由 CliExecutor 在发请求前调用，把「SDK 就绪」变为
     * 请求的前置条件。
     *
     * - 已就绪 / 已判定未启用：立即返回当前 ready 状态；
     * - 初始化中：await 在途 _initPromise（受 deadline 约束）；
     * - 超时：返回 false，调用方按有界降级处理（不抛错）。
     */
    waitForReady(timeoutMs?: number): Promise<boolean>;
    /**
     * 强制 flush OTel provider buffer（metrics + trace + logs），但不关闭 provider。
     *
     * 用途：退出前"第一阶段" —— 先把已有数据推出去，后续 cleanup 仍可继续上报。
     * 可重复调用（每次都真正 forceFlush），与 shutdown 的幂等缓存互不影响。
     */
    forceFlush(timeoutMs?: number): Promise<void>;
    /**
     * 强制 flush + 关闭底层 OTel provider。调用后 provider 不再接受新数据。
     *
     * 用途：退出前"最终阶段" —— 所有 cleanup/session-end 跑完后做最后一次 flush 并 shutdown。
     *
     * 实现要点：
     * - **幂等**：缓存 `shutdownPromise`，二次调用直接返回首次的 promise
     * - **总耗时上限 timeoutMs**：避免拖住 CLI 退出。三个 provider 共用一个 deadline。
     * - **任何失败都吞掉**：监控自身不能阻塞进程退出。
     */
    shutdown(timeoutMs?: number): Promise<void>;
    /**
     * 定位 logs 通道可 forceFlush 的句柄 —— 退出前 flush 日志用。
     *
     * 伽利略 SDK 的 Logger 在 `initLogger()` 里把 LoggerProvider 当局部变量持有、只返回
     * `loggerProvider.getLogger(...)` 的结果，外部拿不到 provider 本身。因此按以下顺序探测：
     * provider 反向引用（`_loggerProvider` / `loggerProvider`）→ `_sharedState.activeProcessor`。
     * SDK 0.3.x 依赖的 OTel sdk-logs Logger 只暴露 `_sharedState`，其 activeProcessor 同样实现
     * forceFlush/shutdown（LoggerProvider 本身也只是转调它），是这些版本上唯一可用的句柄。
     *
     * 全部探测失败时返回 null —— 只影响退出前的日志 flush，不影响主流程。
     */
    private resolveLogFlushHandle;
    /**
     * Promise + deadline 竞速：
     * - 到 deadline 强制 resolve（不抛），让上层 safe() 继续往下走
     * - promise 自己抛错则**透传 reject**，由上层 safe() 的 try/catch 接住并 warn 哪一路坏了
     * `label` 仅用于排错日志区分通道。
     */
    private withTimeout;
    /** 注入 turn baggage 与全局维度；调用方显式 dimensions 优先。 */
    private withGlobalDimensions;
    /** 注入 turn baggage 与全局属性；调用方显式 attrs 优先。 */
    private withGlobalAttrs;
    private static otlpHttpProxyAgentPatched;
    /**
     * Galileo SDK 的 OTLP/HTTP exporter 默认不会读 HTTPS_PROXY；并且它内部依赖路径在
     * Rspack bundle 后不适合直接 require/patch。这里改为对 Node https.request 做一个
     * 很窄的补丁：只给当前 Galileo endpoint hostname 的 HTTPS 请求注入 HttpsProxyAgent。
     */
    private patchOtlpHttpProxyAgent;
    private handleProductConfigurationChanged;
    /**
     * 构造 GalileoLogger 全局静态属性 — SDK 会把这些自动挂到每条 log 的 tags.* 下。
     *
     * 设计原则：
     * - **只挂静态值**（构造一次永久复用）。运行时易变值（freemem / uptime / heap）
     *   走 metrics（gauge / histogram）通道，不要塞 attribute。
     * - **不挂隐私敏感字段**（hostname / userInfo），避免 PII 泄露。
     * - **不与伽利略后台 IP enrich 字段重复**（country/city/ip/isp 由后台自动塞）。
     * - **value 全部 string**（SDK 类型 `Attributes = { [k: string]: string }` 强约束）。
     * - **可选字段缺失时不下发**（不下发空字符串），便于 BI 用 `tags.x =~ ".+"` 干净过滤。
     *
     * 字段来源：
     * - `os` / `arch` / `osVersion` / `cpuCores` / `cpuModel` / `memoryGB`：Node 内置 API
     * - `nodeVersion`：`process.version`
     * - `appName` / `appVersion` / `extName` / `extVersion` / `ideType` / `downloadChannel`：
     *   desktop main 通过 `CLIENT_INFO_*` 环境变量注入（见
     *   `apps/workbuddy-desktop/src/main/runtime/workbuddy-client-info-env.ts`）；
     *   裸 agent-cli 模式下 fallback 为 `'agent-cli'` 或不下发。
     */
    private buildGlobalLogAttributes;
    private static readonly execFileAsync;
    private static readonly GPU_DETECT_TIMEOUT_MS;
    private detectGpuInfo;
}
