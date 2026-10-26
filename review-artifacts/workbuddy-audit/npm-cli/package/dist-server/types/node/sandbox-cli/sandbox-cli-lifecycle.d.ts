import { Logger } from '@celljs/core';
import { Workspace } from '@genie/runtime';
import { SandboxCliLifecycleRuntimeImpl, SandboxLifecycleRecovery } from '@genie/sandbox-cli/sandbox-cli-lifecycle-runtime';
import type { SandboxDaemonStartupType } from '@genie/telemetry';
import type { SandboxTelemetryReporter as ISandboxTelemetryReporter } from '../telemetry/sandbox-telemetry-protocol';
import { type BootstrapOptions, type ISandboxCLILifecycle } from './sandbox-cli-lifecycle-protocol';
import { type SandboxCLIClient as ISandboxCLIClient, type SandboxCLIProcessManager as ISandboxCLIProcessManager } from './sandbox-cli-protocol';
/**
 * SandboxCLILifecycle 实现
 *
 * 只依赖 SandboxCLIClient + SandboxCLIProcessManager + Logger。
 *
 * 职责：
 * - spawn sandbox-cli 进程 + 建立 IPC 连接 + 发 OpenSession
 * - ping 探活与失败重启
 * - 命令式 session 切换（CloseSession + OpenSession）
 * - 缓存 bootstrap 时 OpenSession 返回的 workingDir
 * - 用 _readyGeneration 计数器通知外部 "OpenSession 成功发生过几次"
 *
 * 不做的事：
 * - 不注册 reverse handler（由 SandboxShellService 负责）
 * - 不下发 bash 沙箱规则（由 SandboxShellService 负责）
 */
export declare class SandboxCLILifecycleImpl extends SandboxLifecycleRecovery<BootstrapOptions> implements ISandboxCLILifecycle {
    protected readonly client: ISandboxCLIClient;
    protected readonly processManager: ISandboxCLIProcessManager;
    protected readonly logger: Logger;
    protected readonly telemetryReporter?: ISandboxTelemetryReporter;
    protected readonly workspace?: Workspace;
    private _startupAssetFailure;
    private _runtime;
    protected _startupStage: 'helper' | 'process-start' | 'handshake' | 'open-session';
    /**
     * 急切连接预算（毫秒）。spawn 即返回后由 client 的 10ms 重试循环等管道就绪
     * （实测 sandbox-cli 监听就绪 B 机 8~18ms / A 机 ~186ms，慢盘冷启动 ~700ms）。
     * 必须小于准备链的 10s 截止（SandboxAgentRunInterceptor.SANDBOX_READY_TIMEOUT_MS）
     * ——外层 race 到点时连接必须已有结论，不能让连接把链拖过截止线。
     *
     * 历史值为 client 默认 10s；#139770 异步化时曾收紧到 1.5s（对齐当时的 2s
     * 链截止），但低端机/杀软长尾冷启动管道就绪可超 1.5s（#155450：e2e 现场
     * ~1.7-2.0s）→ connect 提前失败 → ensureReady 误判沙箱不可用 → interceptor
     * fail-open 降级 → 文件审批 guard（ask/deny 规则）随 useSandboxCLI=false
     * 被静默跳过，构成安全旁路。链截止已恢复 10s（#150218/#153201），此处同步
     * 放大到 8s：覆盖慢冷启动，仍留 ~2s 给 spawn 与 OpenSession，严格小于链截止。
     */
    private static readonly CONNECT_BUDGET_MS;
    ensureReady(options: BootstrapOptions): Promise<void>;
    getClient(): ISandboxCLIClient;
    protected onStartupBegin(): void;
    protected onStartupSuccess(startupType: SandboxDaemonStartupType, startupStartedAtMs: number): void;
    protected onStartupFailure(err: any, timedOut: boolean, startupType: SandboxDaemonStartupType, startupStartedAtMs: number): void;
    protected onPingFailure(pingErr: any): void;
    protected onRestartFailure(restartErr: any): void;
    protected getStartedAtMs(): number | undefined;
    protected _getRuntime(): SandboxCliLifecycleRuntimeImpl;
    /**
     * 拼出 `sandbox.daemon.failure` 上报埋点的关联字段（conversationId /
     * conversationRequestId）。所有 lifecycle 内的
     * 上报点末尾 spread 调用，保证 5 个 phase 字段一致。undefined 字段被
     * reporter 的 `_buildAttributes` 自动剔除。
     *
     * - conversationId 取 `_openedSessionId`，未握手成功时回退到 bootstrapOptions.sessionId
     * - conversationRequestId 仅在 client 只有一个 in-flight 请求时提取；并发场景无法
     *   精确归因时省略，避免拼接出无法参与关联查询的伪 requestId
     */
    private _daemonFailureContext;
    /**
     * 启动终态事件的关联上下文。
     *
     * bootstrap 的 conversationRequestId 来自本次 ensureReady 入参；restart 只在恰好
     * 一个请求 in-flight 时关联，避免把首次启动请求误标到后续重启。
     */
    private _daemonStartupContext;
    private _scheduleDaemonStartupFinishedReport;
    private _scheduleDaemonFailureReport;
    private _consumeProcessStartupFailure;
    private _markProcessSessionEstablished;
    private _logTelemetryFailure;
    private _normalizeStartupFailure;
    /**
     * 启动 sandbox-cli 进程（如尚未运行），获取 IPC 地址后建立连接，
     * 发送 OpenSession 请求，缓存响应的 workingDir，递增 generation。
     */
    protected _startAndConnect(): Promise<void>;
    /**
     * macOS: 确保 WorkBuddySandboxHelper 正在运行(全机单例)。
     *
     * Helper 持有 FileProvider domain / used-slots.json / sessions-registry.json
     * 等系统级共享状态,必须全机一份,否则会出现 slot 抢占、registry 互相覆盖
     * 等致命问题。
     *
     * 多个 Electron 实例共享同一个 Helper 通过 App Group 容器中的 socket 通信:
     *   ~/Library/Group Containers/{appGroupId}/sandbox-ext.sock
     *
     * 启动流程(每个 sandbox-cli 实例都会走一遍):
     *   1. 探测 socket 是否已有进程在监听 → 是则直接复用
     *   2. 抢 spawn 锁(O_CREAT|O_EXCL 锁文件,跨进程互斥)
     *      - 抢到 → 自己 spawn,启动后等 socket 就绪,释放锁
     *      - 抢不到 → 别人正在 spawn,轮询等 socket 就绪即可
     */
    private _ensureHelperRunning;
    /**
     * 从 sandbox-config.json 读取 NetworkExtension bundle ID。
     */
    private _resolveNetworkExtensionBundleId;
}
