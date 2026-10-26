import { AgentRunInterceptor, AgentRunInterceptorPriority, AgentRunRequest } from '../../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { type BashSandboxManager as IBashSandboxManager } from '../../bash-sandbox/bash-sandbox-protocol';
import { isSandboxCLIPlatformSupported } from '../../sandbox-cli/sandbox-backend-support';
import { type ISandboxCLILifecycle } from '../../sandbox-cli/sandbox-cli-lifecycle-protocol';
import { type SandboxCLIProcessManager as ISandboxCLIProcessManager } from '../../sandbox-cli/sandbox-cli-protocol';
import { type SandboxRuleSyncService as ISandboxRuleSyncService } from '../../sandbox-cli/sandbox-rule-sync-service';
import { isFileBackupSupported, normalizeFileBackupMaxSizeMB, shouldUseSandboxCLI } from '../../sandbox-cli/sandbox-session-preparation';
import { SandboxTurnConfig } from '../../sandbox-cli/sandbox-turn-config';
import { type ThreatDomainChecker as IThreatDomainChecker } from '../../sandbox-cli/threat-domain-checker';
import { type SandboxCenterIpcClient as ISandboxCenterIpcClient } from '../../sensitive-content/sandbox-center-ipc-client-protocol';
import { SettingsManager } from '../../settings';
import { type SandboxTelemetryReporter as ISandboxTelemetryReporter } from '../../telemetry/sandbox-telemetry-protocol';
export declare function areSandboxExperimentalFeaturesSupported(): boolean;
export { isSandboxCLIPlatformSupported };
export { isFileBackupSupported, normalizeFileBackupMaxSizeMB, shouldUseSandboxCLI };
export declare class SandboxAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly logger: Logger;
    protected readonly settingsManager: SettingsManager;
    protected readonly sandboxTurnConfig: SandboxTurnConfig;
    protected readonly sandboxLifecycle?: ISandboxCLILifecycle;
    protected readonly sandboxCenterClient?: ISandboxCenterIpcClient;
    protected readonly processManager?: ISandboxCLIProcessManager;
    protected readonly telemetryReporter?: ISandboxTelemetryReporter;
    protected readonly sandboxRuleSyncService?: ISandboxRuleSyncService;
    protected readonly bashSandboxManager?: IBashSandboxManager;
    protected readonly threatDomainChecker?: IThreatDomainChecker;
    /**
     * 标记本轮 intercept 执行期间 onSessionReady 回调是否已完成配置同步。
     * 用于 bootstrap 场景下避免 ensureSandboxReady 回调和 intercept 后续代码
     * 重复执行 syncModifyBackupConfig / syncRulesOnTurnStart。
     */
    private readonly executionStates;
    private readonly defaultState;
    /**
     * in-flight center 同步互斥（备份配置 + 规则下发打包），**按 sessionId 分**
     * （CR#2：拦截器是单例，进程内多会话并存时不分 key 会让后到的会话等先到
     * 会话的同步、自己的规则漏下发却误置 synced——桌面端两个会话同时发消息
     * 即触发）。onSessionReady 回调与本轮 intercept 的并行链几乎同时到达
     * **同一 session**：先到者执行，后到者 await 同一结果，不重复全量下发。
     */
    private readonly _centerSyncInFlightBySession;
    /** 本轮（per-session）center 同步完成标记，onSessionReady 与 intercept 共用。 */
    private readonly _sessionSynced;
    private _runCenterSyncOnce;
    /** 备份配置同步 + （沙箱开启时）规则下发。onSessionReady 与 intercept 共用。 */
    private _centerSync;
    /** center 同步段的预算：与链截止对齐（bootstrap 10s + 并行余量）。 */
    private withCenterSyncBudget;
    private get turnState();
    init(): void;
    intercept(request: AgentRunRequest): Promise<void>;
    /**
     * 经 session barrier 执行准备链（single-flight），并 await 落定。
     * host-backed execution 的同步语义——异常必须穿透 barrier
     * （fail-closed：沙箱起不来让 run 失败）。
     */
    private _prepareTurnViaBarrier;
    /**
     * fire-and-forget 启动（或复用）session 准备链，立即返回。
     * 消费路径 intercept 委托入口：准备链在后台跑（与拦截器链后续部分 /
     * 模型请求并行），落定后 session barrier 标记自动清除。
     * 不抛出：所有异常在链内按 fail-open 口径处理（沙箱是从属能力，
     * 故障只降级不阻断对话）。
     */
    kickoffPrepareChain(request: AgentRunRequest): void;
    /**
     * 单轮沙箱准备全流程（原 intercept 主体）。
     * {@link _startSessionPrepareBarrier} fire-and-forget 调用。
     */
    private _prepareTurn;
    private enableTrace;
    private syncModifyBackupConfig;
    /** 固化当前轮次的 SandboxTurnConfig 日志快照，避免输出后被下游 interceptor/hook 改写。 */
    private snapshotSandboxTurnConfig;
    private _deriveTurnDisabledReason;
    private _logTurnTelemetryFailure;
    /**
     * fail-open 包装的 turn 起始规则同步。
     *
     * 规则同步失败时 center 里可能残留上一轮的表（松紧都有可能），本轮
     * ruleProfile 仍按 permissionMode 决定，不去猜旧表、也不改执法口径。
     * 对话主链路恒继续：沙箱是从属能力，从属能力故障不得阻断对话。
     *
     * 取舍：onSessionReady 失败后 _sessionReadySyncedThisTurn 仍置 true，
     * 同 turn 的 intercept 不重试（避免 5s 连接超时双倍卡死）；下一 turn
     * 再全量同步。真正防止钉死死 socket 的是 sidecar 纪元门禁。
     *
     * 生产事故反例（case 2）：残留旧纪元 sidecar 下，规则同步因 center 连不上
     * 5s 超时抛出，异常穿出 intercept() → agent-service 的 interceptor 循环
     * 将整个 run 判为 RUN_FAILED → 用户侧 3003"网络请求超时"，对话完全不可用。
     */
    private syncRulesFailOpen;
    /**
     * sandbox 生命周期管理：session 冲突检测 + ensureReady + 超时控制。
     *
     * @returns true 表示 sandbox 已就绪；false 表示启动失败，调用方应降级到本地执行。
     */
    private ensureSandboxReady;
    /**
     * 同步威胁库，失败与超时都只降级恶意域名匹配这一层。
     *
     * 必须自己兜住异常，不能并进 ensureSandboxReady 的 try：
     * - 抛异常会落到 `return false`，等于把本轮沙箱的文件保护和网络策略一起关掉，
     *   与设计里“恶意库不可用只关哈希匹配”的 fail-open 原则相反；
     * - ThreatDomainChecker 已给 SET/CHECK 设置独立短超时，这里不再叠加一个不能
     *   取消底层 IPC 的 Promise.race。
     */
    private syncThreatDatabase;
}
/** Telemetry interceptor 生成请求 ID 后，上报主用户 Turn 的 Sandbox 最终状态。 */
export declare class SandboxTurnTelemetryAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly logger: Logger;
    protected readonly telemetryReporter?: ISandboxTelemetryReporter;
    intercept(request: AgentRunRequest): Promise<void>;
    private _logFailure;
}
