import { Logger } from '@celljs/core';
import { CliRuntimeOptions } from '../cli/cli-runtime-options';
import { type IPrewarmStateService } from '../prewarm/prewarm-protocol';
import { McpReadyService } from './mcp-protocol';
/**
 * Lightweight service for triggering headless MCP config initialization.
 *
 * This service is independent of McpManager to avoid circular dependencies.
 * McpManager still calls resolve() for legacy bounded observers, but ordinary
 * startup/model paths do not treat all external connections as readiness.
 *
 * Must be a singleton because the deferred state needs to be shared across the application.
 *
 * Connection waits are intentionally handled by McpManager's bounded,
 * generation-aware APIs rather than by this process-level service.
 */
export declare class McpReadyServiceImpl implements McpReadyService {
    private readonly deferred;
    private resolved;
    /**
     * Guards the one-time DYNAMIC MCP config initialization performed by
     * {@link ensureHeadlessMcpConfigInitialized}.
     */
    private headlessMcpConfigEnsured;
    protected readonly logger: Logger;
    protected readonly cliRuntimeOptions: CliRuntimeOptions;
    protected readonly prewarmState: IPrewarmStateService;
    /**
     * 订阅 argv 就绪信号，重新评估 headless 下的 DYNAMIC MCP 初始化时机。
     * argv（CliRuntimeOptions.onDidChange，BehaviorSubject）决定 `--mcp-config` /
     * `--strict-mcp-config` 的 DYNAMIC payload 与是否屏蔽文件系统 scope。
     *
     * prewarm 时序（standby → activate）：
     *   - **待命期**：McpReadyService 是"自身 @PostConstruct 自触发 init"类型。若此刻就
     *     subscribe argv 臂，其 BehaviorSubject 种子值会立即触发 ensureHeadlessMcpConfigInitialized
     *     → 用冷启动空 argv（无真实 --mcp-config）latch 错误 DYNAMIC，污染
     *     McpManager.indexedDeferServers。因此 standby 期**不立刻 subscribe**，而是把
     *     "subscribe argv 臂"这个动作本身注册为激活 handler（onActivated）。
     *   - **activate 后**：markActivated() 点火该 handler，此刻 applyPrewarmArgs 已剔除
     *     --prewarm、注入真实 --mcp-config，subscribe 时 BehaviorSubject 种子值立即触发一次
     *     ensureHeadlessMcpConfigInitialized → 正常 latch DYNAMIC，SDK initialize 的
     *     readDynamic() 不再赛跑吃满超时。
     *   - **非 prewarm 冷启动**：直接 subscribe（与历史行为一致）。
     *
     * cwd 臂已移除：activate 的 DYNAMIC latch 由本 handler 在 markActivated 时完成，
     * 不再依赖 setCwdState 广播驱动的 onDidChangeCwd。
     */
    protected watchArgvAndCwdForMcpInit(): void;
    /**
     * Trigger headless config initialization without making external MCP
     * connections a process-level readiness barrier.
     */
    waitForServersReady(): Promise<void>;
    /**
     * Wait for MCP servers to settle, capped by `timeoutMs`. Mode-agnostic.
     *
     * Unlike {@link waitForServersReady}, this method:
     * - does NOT skip in TUI mode
     * - does NOT trigger McpCliConfigInitializer (only consumes the existing readiness signal)
     * - never rejects on timeout — resolves silently so callers can fall back to "not ready"
     *
     * Resolves immediately when servers are already settled, so the timeout is
     * a strict upper bound — fast connections do not pay the full wait.
     */
    waitFor(timeoutMs: number): Promise<void>;
    /**
     * Headless indicators: --print/-p, --acp, --serve, -h/--help, or non-TTY stdout.
     * --serve (WorkBuddy Desktop sidecar) counts as headless — it runs as a
     * background HTTP server with no TTY.
     *
     * 纯运行模式判断，**与 prewarm 无关**：预热待命期不初始化 DYNAMIC 由
     * {@link watchArgvAndCwdForMcpInit} 在 standby 时把 argv 订阅整体延后到
     * markActivated 负责，本方法不再掺 `--prewarm` 特判。
     */
    private isHeadless;
    /**
     * Initialize the DYNAMIC MCP config scope exactly once in headless mode.
     *
     * This sets DYNAMIC (to the --mcp-config payload, or `{}` when absent) and
     * triggers non-interactive server connections. Setting DYNAMIC is what resolves
     * McpConfigManager.dynamicConfigInitialized, so readDynamic() never blocks.
     *
     * Must run independently of `resolved`: McpManager calls resolve() as soon as
     * servers settle (e.g. a ~16ms in-proc SDK MCP server), and that early resolve
     * must NOT be allowed to skip DYNAMIC initialization — otherwise the gate stays
     * shut and the agent build / SDK initialize deadlock. McpCliConfigInitializer is
     * itself idempotent; the local flag just avoids redundant ContainerUtil lookups.
     */
    private ensureHeadlessMcpConfigInitialized;
    /**
     * Mark servers as ready.
     */
    resolve(): void;
}
