import { Logger } from '@celljs/core';
import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { Workspace } from '@genie/runtime';
import { SandboxRulesDeltaApplier } from '@genie/sandbox-cli/sandbox-rules-delta-applier';
import type { BashSandboxManager as IBashSandboxManager } from '../bash-sandbox/bash-sandbox-protocol';
import { type SandboxCenterIpcClient as ISandboxCenterIpcClient } from '../sensitive-content/sandbox-center-ipc-client-protocol';
import { SettingsManager } from '../settings';
import { type ShellExecuteParams, type ShellExecutionHandle, type ShellService } from '../shell/shell-protocol';
import type { SandboxTelemetryReporter as ISandboxTelemetryReporter } from '../telemetry/sandbox-telemetry-protocol';
import { type ISandboxCLILifecycle } from './sandbox-cli-lifecycle-protocol';
import { type ISandboxShellService, type SandboxRulesDelta } from './sandbox-cli-protocol';
import { type SandboxRuleSyncService as ISandboxRuleSyncService } from './sandbox-rule-sync-service';
import { type SandboxTurnConfig as ISandboxTurnConfig } from './sandbox-turn-config';
import { type ThreatDomainChecker as IThreatDomainChecker } from './threat-domain-checker';
export declare function shouldUseSandboxPty(params: ShellExecuteParams, platform?: NodeJS.Platform): boolean;
/**
 * Sandbox Shell 服务
 *
 * 实现 ShellService 接口，将所有 Shell 命令执行委托给 SandboxCLIClient，
 * 由 sandbox-cli 在隔离沙箱环境中执行。
 *
 * 生命周期管理（spawn / connect / OpenSession / ping / session 切换）完全交给
 * SandboxCLILifecycle 负责；本服务只关心 Shell 执行相关的东西：
 * - reverse handler 注册（ProcessOutput / ProcessExit 事件 + ReportEvent）
 * - 命令格式化、句柄创建、结果增强
 *
 * 沙箱规则下发由 SandboxAgentRunInterceptor 在真实用户 turn 开始时调用
 * SandboxRuleSyncService 统一负责，本服务不再直接参与规则同步。
 *
 * reverse handler 通过 lifecycle.onSessionReady 回调注册，在 OpenSession 成功后
 * 立即就位，无需等到首次 execute 调用。
 *
 * 注意：使用独立的 SandboxShellService Symbol 注册，不与默认 ShellServiceImpl 冲突。
 * 在沙箱模式下通过条件切换或优先级机制替换默认实现。
 */
export declare class SandboxShellServiceImpl extends SandboxRulesDeltaApplier implements ShellService, ISandboxShellService {
    protected readonly lifecycle: ISandboxCLILifecycle;
    protected readonly logger: Logger;
    protected readonly workspace: Workspace;
    protected readonly sessionManager: SessionManager;
    protected readonly settingsManager: SettingsManager;
    protected readonly bashSandboxManager?: IBashSandboxManager;
    protected readonly localShellService: ShellService;
    protected readonly telemetryReporter?: ISandboxTelemetryReporter;
    protected readonly sandboxRuleSyncService?: ISandboxRuleSyncService;
    protected readonly turnConfig?: ISandboxTurnConfig;
    protected readonly sandboxCenterClient?: ISandboxCenterIpcClient;
    protected readonly threatDomainChecker?: IThreatDomainChecker;
    /** 活跃的执行句柄注册表 */
    private readonly activeHandles;
    private readonly executionSessions;
    /** processId → 流式执行句柄路由表，用于反向事件分发 */
    private readonly processHandles;
    /** Windows sandbox Bash staged payload 的幂等清理函数。 */
    private readonly stagedScriptCleanups;
    /**
     * reverse handler 是否已挂（同一 client 实例生命周期内只挂一次）。
     * SandboxCLIClient 是 DI 单例，即便 sandbox-cli 进程 restart，client 对象本身
     * 不变，所以回调依然有效。
     */
    private _reverseHandlerRegistered;
    /** Sandbox session 就绪后注册反向事件处理。 */
    init(): void;
    /**
     * 注册 reverse handler（ProcessOutput / ProcessExit / ReportEvent）。
     *
     * 在组件初始化时挂载，不依赖 OpenSession；客户端的监听在重启后仍保留。
     * 幂等守卫避免重复初始化注册多份回调。
     */
    private _registerReverseHandlers;
    private _openSandboxBrokerExecution;
    private _assertBrokerCapabilities;
    /**
     * 格式化用户命令。
     * - bash/zsh: CODEBUDDY_SHELL_PREPEND_PATH 重前置 + env file 注入 + eval 包装 + shell prefix，
     *   目录变量与 env 文件从这次调用的合并环境读
     * - powershell: 直接传原始命令（不做 eval 包装、不注入 ENV_FILE）
     */
    private formatCommand;
    /**
     * 构建结构化的沙箱命令描述，直接对应 CreateProcessW(lpApplicationName, lpCommandLine)
     * 与 POSIX execve(path, argv) 的原生模型。
     */
    private buildSandboxCommand;
    private _trackStagedScriptCleanup;
    private _bindStagedScriptCleanup;
    private _resolveSandboxShellConfiguration;
    /** 这次调用的基础环境：worker 环境，宿主 shell 环境策略的 set 叠在上面。 */
    private processEnvFor;
    /** 给沙箱内子进程注入产品级默认 env（强制覆盖，调用方不可覆盖）。 */
    private _withDefaultSandboxEnv;
    private _getCommandRoot;
    execute(params: ShellExecuteParams): Promise<ShellExecutionHandle>;
    /**
     * 每条 Sandbox 命令执行前读取一次 daemon 发布的 state.json。
     *
     * 路径和 lifecycle generation 未变化时不会重复发送 SetThreatDatabase；若 DB
     * 在当前 turn 中刚下载完成，或 ensureAlive 刚重启了 sandbox-cli，则本条命令
     * 会在 RunExecutable 前加载新 DB。任何同步异常只降级威胁库能力，不影响现有
     * Sandbox 命令执行链路。
     *
     * ThreatDomainChecker 为 SET/CHECK 控制命令设置独立短超时；这里不再叠加一个
     * 无法取消底层 IPC 的 Promise.race，避免产生已经返回但仍挂在后台的孤儿请求。
     */
    private syncThreatDatabaseBeforeExecute;
    /**
     * 落盘 Center 放行类文件操作的安全审计。
     *
     * 拦截类记录会进审批流，由 SandboxOrchestrator 在裁决时写审计；放行类不经
     * 审批，必须在 drain 记录处补写，否则 brokered 文件访问不留审计痕迹。
     * 按 (action, operation, matchedRule) 合并路径，与宿主侧审计的分组口径一致。
     */
    private _appendBrokerAllowedFileAudits;
    /**
     * Create a single sandboxed execution handle.
     *
     * Previous revisions ran post-exec escalation here (sandbox-internal retry
     * with `addFileRule(source=temp|session)`). That responsibility has moved
     * to {@link SandboxOrchestrator}, which performs Codex-style bypass retry
     * through `LocalShellService` on user approval. This method therefore
     * just forwards to `createPipeHandle` and wraps `wait()` only to fill in
     * the `sandboxDenied` / `sandboxBlockedPaths` fields that the orchestrator
     * consults when deciding whether to prompt for escalation.
     */
    private _createHandle;
    private createPtyHandle;
    /**
     * 安全删除拦截命令：这些命令需要走 bash shell wrapping 让 BASH_ENV 注入的
     * rm() 函数生效，不能作为 rawCommand 直接 spawn rm.exe（rm.exe 是真删）。
     */
    private static SAFE_DELETE_COMMANDS;
    private _warnIfSafeDeleteRuntimeUnavailable;
    private _needsSafeDeleteShellWrap;
    private _resolveSandboxExtensionClasses;
    private createPipeHandle;
    applyRulesDelta(delta: SandboxRulesDelta): Promise<void>;
    protected syncThreatDatabaseOnRulesChange(sessionId: string): Promise<void>;
    disposeAll(): Promise<void>;
    getActiveHandleCount(): number;
    protected isValidDirectory(dirPath: string): boolean;
    private getNetworkDecisionTarget;
    /**
     * 把一次进程生命周期内的网络拦截记录写入安全审计。
     *
     * 同一域名在一次调用内可能被反复拦截（如 `curl --retry`），按域名和原因合并
     * 后再落审计，避免安全中心被同一次命令刷屏。
     */
    private auditDecisionRecords;
    /**
     * 上报一次 Bash 侧恶意域名命中。
     *
     * 单独 try/catch 而不是靠外层：外层那个 catch 一旦接住异常就会跳出整个循环，
     * 后面几条记录的**审计**也跟着丢。埋点比审计次要，不能反过来拖累它。
     */
    private reportMaliciousHit;
    /**
     * 强制收尾所有挂起的执行句柄。
     *
     * 在 sandbox-cli 连接断开时调用。所有还在等待 processExit 反向通知的
     * handle 都不会再收到事件，这里用一个非零 exitCode + killed=true 主动 fire
     * 让上层（BashTool 等）从 await wait() 中返回错误，避免 UI 永久卡死。
     *
     * @param reason 断连原因，仅用于日志诊断
     */
    private _failAllProcessHandles;
    /** 统一处理 sandbox-cli 运行中事件。 */
    private _handleReverseRequest;
    private _enrichResult;
}
