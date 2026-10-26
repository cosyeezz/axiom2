import { Logger } from '@celljs/core';
import { type SandboxCliProcessExitEvent, SandboxCliProcessRuntimeImpl, type SandboxCliProcessStartupFailure } from '@genie/sandbox-cli/sandbox-cli-process-runtime';
import type { SandboxTelemetryReporter as ISandboxTelemetryReporter } from '../telemetry/sandbox-telemetry-protocol';
import { type SandboxCLIProcessManager as ISandboxCLIProcessManager, type SandboxCLIProcessStartOptions, type SandboxCLIStartupFailure } from './sandbox-cli-protocol';
/**
 * SandboxCLI 进程管理器实现
 *
 * 负责启动 sandbox-cli.exe 子进程并管理进程的生命周期。
 * 通过 --config 命令行参数传入 JSON 配置（包含 IPC 地址、extraPath 等），
 * sandbox-cli 根据配置自行创建 IPC 服务端。
 */
export declare class SandboxCLIProcessManagerImpl extends SandboxCliProcessRuntimeImpl implements ISandboxCLIProcessManager {
    constructor();
    protected logger: Logger;
    protected readonly telemetryReporter?: ISandboxTelemetryReporter;
    private _ipcAddress;
    private _managerStartPromise;
    /** `_state='running'` 时记的起点，用于算 daemon.failure 的 uptimeMs */
    private _startedAtMs;
    /** OpenSession 是否成功；只用于区分意外 close 属于 startup 还是 runtime。 */
    private _sessionEstablished;
    private _startupFailure;
    /** _resolveSandboxCLIPath() 最近一次解析到的 exe 完整路径，GC 用于反解当前版本目录。 */
    private _resolvedExePath;
    /**
     * 启动时 store 的关联上下文，仅供 `sandbox.daemon.failure` 上报埋点。
     * 4 处 process-manager 上报点（startup-cli-not-found / startup-spawn-error /
     * startup-window-exit / runtime-exit）共享。
     *
     * runtime-exit 用 startup 时的 conversationRequestId 是合理近似（daemon 异步死时
     * 没有"当前请求"上下文，最贴近的是它起来时为哪次请求服务的）。
     */
    private _startSessionId;
    private _startConversationRequestId;
    /** process.on('exit') 兜底清理 handler，确保 agent-cli 退出时同步 kill sandbox-cli */
    private _exitHandler;
    /**
     * 已登记到退出 registry 的 PID。
     *
     * 不能在注销时回头读 `getProcess()`：正常 `stop()` 会先由共享 runtime 的
     * `stopProcess()` 清空进程句柄，之后再取 PID 就是 undefined，registry 里会留下
     * 陈旧 PID，等系统复用该 PID 后 `killAllSync` 可能误杀无关进程。
     */
    private _registeredPid;
    init(): void;
    start(options?: SandboxCLIProcessStartOptions): Promise<string>;
    markSessionEstablished(): void;
    consumeStartupFailure(): SandboxCLIStartupFailure | undefined;
    stop(): Promise<void>;
    isRunning(): boolean;
    /** daemon.failure 事件 uptimeMs 字段的起点；非 running 状态返回 undefined */
    getStartedAtMs(): number | undefined;
    private _doStart;
    protected onRuntimeProcessStartupFailure(failure: SandboxCliProcessStartupFailure): void;
    protected onRuntimeProcessError(error: unknown): void;
    protected onRuntimeProcessExit(event: SandboxCliProcessExitEvent): void;
    private _resolveSandboxCenterUid;
    /**
     * 解析 sandbox-cli 可执行文件路径。
     *
     * 路径解析由 @genie/sandbox-cli 统一维护；这里仅负责 Agent CLI 的日志、
     * 启动失败状态和宿主 PathUtils 注入。
     */
    private _resolveSandboxCLIPath;
    /**
     * 异步 GC 旧版本 sandbox 目录。
     * 在 sandbox-cli 启动成功后调用，保留当前版本，删除其余旧版本。
     * 被锁定的文件/目录静默跳过。
     */
    private _gcOldSandboxVersions;
    /**
     * 构建 sandbox-cli 启动配置 JSON。
     */
    private _buildStartConfig;
    private _unregisterPid;
    private _cleanup;
    /**
     * 拼出 `sandbox.daemon.failure` 上报埋点的关联字段。值取自 `_doStart` 入口
     * 缓存的 startup options。
     */
    private _daemonFailureContext;
    private _buildDaemonFailurePayloadSafely;
    private _scheduleDaemonFailureReport;
    private _logTelemetryFailure;
}
