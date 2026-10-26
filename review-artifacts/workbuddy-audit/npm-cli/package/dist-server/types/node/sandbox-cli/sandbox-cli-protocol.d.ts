/**
 * Sandbox CLI Protocol
 *
 * 定义 agent-cli 与 SandboxManager 之间的 IPC 通信协议。
 * 与 Rust 侧 `sandbox/src/ipc/protocol.rs` 中的 `IpcMessage` 结构完全对齐，
 * 使用统一的 NDJSON（Newline-Delimited JSON）格式通信。
 *
 * 消息区分规则：
 * - 请求消息：`success` 字段为 undefined（不存在）
 * - 响应消息：`success` 字段为 boolean（true=成功, false=失败）
 *
 * 消息流向：
 * - 正向请求：agent-cli → SandboxManager（如 OpenSession, RunExecutable 等）
 * - 正向响应：SandboxManager → agent-cli（对正向请求的响应）
 * - 反向事件：SandboxManager → agent-cli（ProcessOutput / ProcessExit，fire-and-forget）
 *
 * **命令名称一律采用 PascalCase**，以 Rust 侧 `ipc/protocol.rs::commands` 常量为唯一真相源。
 */
import type { FileBlockReason, FileBlockRecord, NetworkBlockReason, NetworkBlockRecord } from '@genie/sandbox-cli/decision-record-projection';
import type { SandboxCommand as ProtocolSandboxCommand } from '@genie/sandbox-cli/protocol';
import { FILE_READ_METADATA_OPERATION, FORBIDDEN_PROGRAM_BLOCK_REASON, getFileBlockOperation, isFileReadMetadataBlockRecord, isForbiddenProgramBlockRecord } from '@genie/sandbox-cli/sandbox-attribution';
import { type SandboxCliClient, type SandboxCliClientConfig, type SandboxCliReverseListenerOptions } from '@genie/sandbox-cli/sandbox-cli-client-contract';
import { isValidSandboxRulesDelta, SandboxRulesApplyError, type SandboxRulesDelta } from '@genie/sandbox-cli/sandbox-rules-delta';
import type { SandboxDaemonFailurePayload, SandboxDaemonFailurePhase } from '@genie/telemetry';
export * from '@genie/sandbox-cli/protocol';
export { FILE_READ_METADATA_OPERATION, FORBIDDEN_PROGRAM_BLOCK_REASON, getFileBlockOperation, isFileReadMetadataBlockRecord, isForbiddenProgramBlockRecord, isValidSandboxRulesDelta, SandboxRulesApplyError, type SandboxRulesDelta, };
export type { FileBlockReason, FileBlockRecord, NetworkBlockReason, NetworkBlockRecord, };
/**
 * Agent CLI 内部兼容视图。Sandbox IPC 已统一为 DecisionRecord；现有业务层继续
 * 使用 FileBlockRecord / NetworkBlockRecord，转换只发生在 IPC 边界。
 */
export declare const SANDBOX_COMMANDS: {
    readonly PING: "Ping";
    readonly OPEN_SESSION: "OpenSession";
    readonly CLOSE_SESSION: "CloseSession";
    readonly DELETE_SESSION: "DeleteSession";
    readonly RUN_EXECUTABLE: "RunExecutable";
    readonly GET_STATISTICS: "GetStatistics";
    readonly REPORT_BLOCK_CHOICE: "ReportBlockChoice";
    readonly PROCESS_WRITE: "ProcessWrite";
    readonly PROCESS_SEND_KEY: "ProcessSendKey";
    readonly PROCESS_RESIZE: "ProcessResize";
    readonly PROCESS_KILL: "ProcessKill";
    readonly PROCESS_IS_ALIVE: "ProcessIsAlive";
    readonly PROCESS_OUTPUT: "ProcessOutput";
    readonly PROCESS_EXIT: "ProcessExit";
    readonly REPORT_EVENT: "ReportEvent";
    readonly RECORD_STATISTICS: "RecordStatistics";
    readonly APPEND_USER_CHOICE: "AppendUserChoice";
};
export type SandboxCommand = ProtocolSandboxCommand;
export interface AddFileRuleItem {
    ruleRef?: string;
    path: string;
    action: string;
    category?: string;
    isDirectory?: boolean;
    comment?: string;
}
export interface AddNetworkRuleItem {
    ruleRef?: string;
    endpoint: string;
    action: string;
    category?: string;
}
export declare const SandboxCLIClient: unique symbol;
export declare const SandboxShellService: unique symbol;
export declare const SandboxCLIProcessManager: unique symbol;
export type SandboxCLIStartupFailurePhase = Extract<SandboxDaemonFailurePhase, `startup-${string}`>;
/** startup failure 结构；字段与 daemon.failure 保持同源。 */
export interface SandboxCLIStartupFailure extends Pick<SandboxDaemonFailurePayload, 'errorMsg' | 'exitCode' | 'signal'> {
    phase: SandboxCLIStartupFailurePhase;
    errorCode: string;
}
/**
 * sandbox-cli 进程启动选项
 */
export interface SandboxCLIProcessStartOptions {
    /**
     * 宿主 App 家目录，透传到 sandbox-cli 的 `--app_home` 参数。
     * Rust 侧在此目录下派生 `sandbox/logs/`、`sandbox/projfs/`、
     * `sandbox/sessions/<id>/` 等子目录。
     * **由调用方显式传入，ProcessManager 不做默认猜测。**
     */
    appHomeDir?: string;
    /**
     * （仅 macOS）App Group ID，透传到 sandbox-cli 的 `--app_group_id` 参数。
     * Rust 侧据此推导 `$HOME/Library/Group Containers/<gid>` 作为 overlay 目录，
     * 以便 FileProvider Extension 直读。非 macOS 下忽略。
     */
    appGroupId?: string;
    /**
     * 是否让 sandbox-cli 分配独立的控制台窗口（通过 --console 触发 AllocConsole）。
     * 开发调试时设为 true 可直接在独立窗口中观察 sandbox-cli 的实时日志。
     * 默认为 false。
     * 也可通过环境变量 SANDBOX_CLI_SHOW_CONSOLE=1 开启。
     */
    showConsoleWindow?: boolean;
    /**
     * 启动上下文，仅供 process-manager 内部 `sandbox.daemon.failure` 埋点关联到当前
     * 用户操作（startup-* phase 全部、runtime-exit 一处）。值在 daemon 整个生命周期内
     * 缓存：runtime-exit 上报的是"daemon 起来时为哪次请求服务的"，对长生命周期 daemon
     * 是一种合理近似（精确的"崩溃时"上下文 lifecycle 的 runtime-* phase 各自独立维护）。
     */
    sessionId?: string;
    conversationRequestId?: string;
}
/**
 * SandboxCLI 进程管理器接口
 *
 * 负责 sandbox-cli 后端进程的生命周期管理：
 * - 启动 sandbox-cli 子进程（通过 --config 传入 JSON 配置，通过 --app_home/--app_group_id 传入路径）
 * - 生成随机 IPC 地址并注入配置
 * - 进程监控和优雅关闭
 */
export interface SandboxCLIProcessManager {
    /**
     * 启动 sandbox-cli 进程并返回 IPC 地址。
     * 随机生成 IPC 地址，通过 --config JSON 参数传入 sandbox-cli。
     * 如果进程已在运行，返回缓存的地址。
     * @param options 可选的启动选项
     * @returns IPC 地址字符串（如 "WorkBuddy_<hex>"）
     */
    start(options?: SandboxCLIProcessStartOptions): Promise<string>;
    /** OpenSession 成功后调用；只用于区分 startup close 与 runtime-exit 遥测。 */
    markSessionEstablished?(): void;
    /** 取走 OpenSession 建立前的进程退出原因，供 lifecycle 统一失败出口归因。 */
    consumeStartupFailure?(): SandboxCLIStartupFailure | undefined;
    /**
     * 停止 sandbox-cli 进程。
     * 先发送 SIGTERM，超时后 SIGKILL。
     */
    stop(): Promise<void>;
    /**
     * 进程是否正在运行
     */
    isRunning(): boolean;
    /** daemon.failure 事件 uptimeMs 字段的起点；非 running 状态返回 undefined */
    getStartedAtMs(): number | undefined;
    /**
     * 订阅"本次启动的进程退出"信号（急切连接模式）。
     * spawn 后 start() 即返回，client.connect 的重试循环消费该信号：
     * 进程在连接建立前退出 → 立即中止重试。返回退订阅函数。
     */
    onStartExit?(listener: (reason: Error) => void): () => void;
}
/**
 * SandboxCLI 客户端配置
 */
export type SandboxCLIConfig = SandboxCliClientConfig;
export declare const DEFAULT_SANDBOX_CLI_CONFIG: SandboxCliClientConfig;
/** 反向事件 listener 的过滤选项 */
export type ReverseListenerOptions = SandboxCliReverseListenerOptions;
/**
 * SandboxCLI 客户端接口
 *
 * 封装与 SandboxManager 进程的 IPC 通信，提供：
 * - 连接管理（connect/disconnect）
 * - 正向请求/响应（sendRequest）
 * - 反向事件处理（onReverseRequest / addReverseListener）
 * - 消息 ID 自动生成与关联
 */
export type SandboxCLIClient = SandboxCliClient;
/**
 * SandboxShellService 的扩展接口，暴露规则热同步能力。
 * 通过 SandboxShellService Symbol 注入后可 cast 到此接口。
 *
 * @throws 当任一 IPC 调用失败时抛出 SandboxRulesApplyError（聚合所有失败项），
 * 调用方（Controller）据此向安全中心报告真实的 synced 状态。
 */
export interface ISandboxShellService {
    applyRulesDelta(delta: SandboxRulesDelta): Promise<void>;
}
