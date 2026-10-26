/**
 * GalileoService — CLI 进程伽利略可观测抽象接口
 *
 * 通过纯 HTTPS OTLP HTTP JSON 协议上报 Metrics/Logs 到伽利略平台，
 * 提供 Histogram（耗时）、Counter（计数）、Logger（结构化日志）三类上报。
 * 所有方法在未就绪时降级为 noop，不影响 Agent 主逻辑。
 */
export declare const GalileoService: unique symbol;
export interface GalileoService {
    /** Histogram 上报（耗时类指标，伽利略自动聚合 P50/P95/P99） */
    recordDuration(metric: string, durationMs: number, dimensions?: Record<string, string>): void;
    /** Counter 上报（计数类指标，支持批量 add） */
    addCounter(metric: string, count: number, dimensions?: Record<string, string>): void;
    /** 结构化日志上报（info 级别，供伽利略 Log 视图查询） */
    logInfo(message: string, attributes?: Record<string, string | number | boolean>): void;
    /** 结构化日志上报（error 级别） */
    logError(message: string, attributes?: Record<string, string | number | boolean>): void;
    /** SDK 是否初始化成功 */
    isReady(): boolean;
    /**
     * 等待 SDK 后台初始化完成（带超时保护）。
     *
     * 用于需要创建真实 span 的调用方（如 TraceStartHook）在冷启动时
     * 等待 Galileo SDK 注册全局 TracerProvider，避免拿到 NonRecordingSpan。
     * 超时后 resolve（不抛错），调用方应检查 isReady() 自行降级。
     *
     * @param timeoutMs 等待上限，默认 5000ms
     */
    waitReady(timeoutMs?: number): Promise<void>;
    /**
     * 等待 galileo SDK 初始化完成（含 AgentLens primary 双报通道挂载）。
     *
     * 非交互快速进程（`-p` / stream-json）在 SDK 就绪前开始 agent run 时，
     * 业务 span 会因 OTel ProxyTracer 未代理到真实 provider 而变成 NonRecordingSpan
     * 整体丢失（Issue #83191）。调用方应在发起 agent 请求前调用本方法，
     * 把「SDK 就绪」变为请求的前置条件。
     *
     * 语义：
     * - 已就绪 / 已判定未启用：立即返回当前 ready 状态；
     * - 初始化中：await 在途 _initPromise（受 deadline 约束，不阻塞超过 timeoutMs）；
     * - 超时：返回 false，调用方按有界降级处理（不抛错）。
     *
     * 注意：返回 `false` **不区分「已判定未启用」与「启用但超时未就绪」**，
     * 调用方需结合 `process.env.GALILEO_ENABLE`（'true' 表示已判定启用）与
     * `GALILEO_SDK_READY`（'0' 表示 doInit 失败）判断具体语义，避免误报。
     *
     * @param timeoutMs 等待总耗时上限，默认 10000ms
     */
    waitForReady(timeoutMs?: number): Promise<boolean>;
    /**
     * 强制 flush OTel provider buffer（metrics + trace + logs），但**不关闭** provider。
     *
     * 适用场景：进程退出前的"第一阶段" —— 先把已有数据推出去，但后续 cleanup 逻辑
     * 仍可继续上报（如 SessionEnd hook 可能再打 counter/log）。
     *
     * 实现：
     * - **可重复调用**：每次都真正 forceFlush（非幂等缓存）
     * - **自带 deadline**：内部最多等 `timeoutMs`，超时后强制 resolve，不抛错
     * - **SDK 未就绪时 noop**
     *
     * @param timeoutMs flush 总耗时上限，默认 2000ms
     */
    forceFlush(timeoutMs?: number): Promise<void>;
    /**
     * 强制 flush + 关闭底层 OTel provider。调用后 provider 不再接受新数据。
     *
     * 适用场景：进程退出前的"最终阶段" —— 所有 cleanup/session-end 逻辑跑完后，
     * 做最后一次 flush 并 shutdown provider。
     *
     * 实现：
     * - **幂等**：可重复调用，二次起直接 noop
     * - **自带 deadline**：内部最多等 `timeoutMs`（默认 2000），超时后强制 resolve，不抛错
     * - **SDK 未就绪时 noop**：`ready=false` 时直接 resolve
     *
     * @param timeoutMs flush + shutdown 总耗时上限，默认 2000ms
     */
    shutdown(timeoutMs?: number): Promise<void>;
}
