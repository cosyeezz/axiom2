import type { ModifyBackupCommittedPayload, SafeDeleteBulkApprovalPayload, SandboxDaemonFailurePayload, SandboxDaemonStartupFinishedPayload, SandboxSafetyTogglePayload, SandboxThreatDatabaseHitPayload, SandboxThreatDatabaseLoadPayload, SandboxTurnStatePayload, SecurityReviewApprovalPayload, SecurityReviewModelCallPayload, SecurityReviewResultProtectionPayload, SecurityReviewToolCallPayload, ToolCallInterceptPayload, ToolCallNativeRerunPayload, ToolCallOutcomePayload, ToolCallSandboxFirstRunPayload } from '@genie/telemetry';
import type { ReportEventRequest } from '../sandbox-cli/sandbox-cli-protocol';
/**
 * Sandbox 上报场景化门面。
 *
 * 设计契约：[apps/workbuddy-desktop/docs/沙盒上报设计.md]。
 *
 * 业务代码调用沙箱事件的**唯一入口**：
 * - 屏蔽底层 `GalileoService.logInfo / logError` 的弱类型
 * - 每个方法对应一个独立伽利略 message，attribute set 各自约束
 * - 集中处理"埋点失败不影响主流程"
 * - 自动剔除 undefined attribute，避免 tags 里塞一堆空值
 *
 * 核心事件（伽利略 message）：
 * - `sandbox.turn_sandbox_cli_usage.recorded` — 每轮 sandbox-cli 生效状态记录
 * - `sandbox.enable_switch.changed`           — 沙箱启用开关状态变更（保留契约，当前无生产注入）
 * - `sandbox.daemon.startup.finished` — sandbox-cli 启动 / 重启尝试终态
 * - `sandbox.daemon.failure`    — sandbox-cli 启动 / 运行期失败（当前生成 11 个 phase 子场景）
 * - `sandbox.tool_call.sandbox_first_run.finished` — 沙箱首跑结果
 * - `sandbox.tool_call.native_rerun.finished` — native 重跑结果
 * - `sandbox.tool_call.outcome` — 命令终局（全量漏斗与分母）
 * - `sandbox.tool_call.intercept` — 用户授权弹窗选择
 * - `sandbox.safe_delete.bulk_approval.finished` — safe-delete 批量删除保护审批结果
 */
export declare const SandboxTelemetryReporter: unique symbol;
/**
 * Sandbox 上报场景化门面接口。每个方法对应一个伽利略事件 message。
 */
export interface SandboxTelemetryReporter {
    reportSecurityReviewToolCall(payload: SecurityReviewToolCallPayload): void;
    /** 每次 reviewer 模型调用（含降级调用）结算一条。 */
    reportSecurityReviewModelCall(payload: SecurityReviewModelCallPayload): void;
    reportSecurityReviewApproval(payload: SecurityReviewApprovalPayload): void;
    reportSecurityReviewResultProtection(payload: SecurityReviewResultProtectionPayload): void;
    /** 每个真实用户 turn 上报本轮 sandbox-cli 是否在执行链路里生效。 */
    reportTurnState(payload: SandboxTurnStatePayload): void;
    /** 安全中心中用户手动切换沙箱启用开关；当前仅保留契约，没有生产调用方。 */
    reportSandboxSafetyToggle(payload: SandboxSafetyTogglePayload): void;
    /** 每次真实 bootstrap / restart 尝试最终严格上报一条。 */
    reportDaemonStartupFinished(payload: SandboxDaemonStartupFinishedPayload): void;
    /**
     * sandbox-cli daemon 失败统一上报入口。
     *
     * 覆盖 daemon 整个生命周期当前生成的 11 个失败 phase（startup-* / runtime-*）。
     * 调用方按 phase 填充对应字段，参考 `SandboxDaemonFailurePayload` 上的
     * 字段命中矩阵。
     */
    reportDaemonFailure(payload: SandboxDaemonFailurePayload): void;
    /**
     * 命令进入沙箱后的首跑结果。
     *
     * 只在命令真正进入沙箱后上报；pre-exec 阶段直接放行 / 拒绝的命令不触发。
     * 本事件记录首跑阶段事实，终局放行 / 拒绝仍由 `reportToolCallOutcome` 表达。
     */
    reportToolCallSandboxFirstRun(payload: ToolCallSandboxFirstRunPayload): void;
    /**
     * native 重跑真实执行结果。
     *
     * 只在沙箱首跑后发生本地重跑时上报；pre-exec 直接本地放行 / 会话缓存放行
     * 不触发。本事件记录 native 重跑是否真的成功，权限链路结论仍由
     * `reportToolCallOutcome` 表达。
     */
    reportToolCallNativeRerun(payload: ToolCallNativeRerunPayload): void;
    /**
     * 真正向用户弹出授权弹窗的拦截场景上报。
     *
     * 由 `SandboxOrchestrator` 在新权限路径真正展示授权弹窗、并拿到用户 `decision`
     * 后调用；auto-approve（零弹窗）与未拦截命令都不触发。
     */
    reportToolCallIntercept(payload: ToolCallInterceptPayload): void;
    /**
     * safe-delete 批量删除保护审批结果。
     *
     * 由 `SandboxOrchestrator` 在 safe-delete runtime 输出 bulk confirm marker、
     * 复用授权 UI 拿到用户选择后调用。它不是沙箱文件 / 网络权限拦截，不应复用
     * `reportToolCallIntercept`。
     */
    reportSafeDeleteBulkApproval(payload: SafeDeleteBulkApprovalPayload): void;
    /**
     * 命令终局全链路上报（pre-exec + post-exec 全漏斗）。
     *
     * 由 `SandboxOrchestrator` 在 `execute()` 的每个终止点调用一条。Payload 中的
     * `stage/outcome/reason/prompted/autoApproveReason` 用于调用点内部归因和兼容，v2
     * reporter 不输出这些旧字段；最终日志使用 `decisionReason/route/permissionResult/
     * sandboxPrompted/autoReleaseReason` 等 v2 字段。与 `reportToolCallIntercept`
     * （真实弹窗子集）互补，本事件提供完整漏斗与分母。
     * `status` 仍由内部 `outcome/reason` 派生（reporter 内部处理）。
     */
    reportToolCallOutcome(payload: ToolCallOutcomePayload): void;
    /**
     * FinalStop 收尾阶段 CommitModifyBackup 成功后上报 modify backup 统计数据。
     *
     * 仅当 IPC 响应同时携带 `totalModifyBackupSizeMb` 和
     * `modifyBackupSessionCount` 时调用。用于观测磁盘占用和 session 数量趋势。
     */
    reportModifyBackupCommitted(payload: ModifyBackupCommittedPayload): void;
    /**
     * 恶意域名威胁库同步尝试结果上报。
     *
     * 只描述实际进入 ThreatDomainChecker 的同步尝试，不代表所有用户 turn 的
     * Sandbox 覆盖率；整体覆盖率需结合 sandbox.turn_sandbox_cli_usage.recorded。
     * reporter 必须是纯旁路，调用异常不得影响 DB 同步或恶意域名判断。
     */
    reportThreatDatabaseLoad(payload: SandboxThreatDatabaseLoadPayload): void;
    /**
     * 上报一次恶意域名命中，回答「防护实际拦下了什么」。
     *
     * 与安全中心审计写入同址、共用同一套去重，条数与用户看到的记录一一对应。
     * reporter 必须是纯旁路，调用异常不得影响拦截行为或审计写入。
     */
    reportThreatDatabaseHit(payload: SandboxThreatDatabaseHitPayload): void;
    /**
     * 接收 sandbox-cli 通过反向事件 `ReportEvent` 上送的原始 envelope。
     *
     * 当前没有任何 scene/action 需要翻译成伽利略事件，全部丢弃：sandbox-cli 每次
     * OpenSession 都会上送 `sandbox_projfs.mount`，静默丢弃避免刷 warn；其余未知
     * scene/action 写 warn 日志后丢弃，便于发现协议漂移。
     */
    ingestRawEvent(envelope: ReportEventRequest): void;
}
export interface SandboxExecResultLike {
    exitCode: number | null;
    signal: NodeJS.Signals | string | null;
    interrupted: boolean;
    sandboxDenied?: boolean;
    /**
     * sandbox 内被升级 / 提权拒绝的标记。仅在升级流程下相关，普通 deny 路径
     * 上不一定填。详见 SandboxOrchestratorResult。
     */
    sandboxEscalationDenied?: boolean;
    fileBlockRecords?: ReadonlyArray<FileBlockRecordLike> | undefined;
    networkBlockRecords?: ReadonlyArray<NetworkBlockRecordLike> | undefined;
}
/**
 * 单条文件拦截记录的窄接口 —— sandbox-cli-protocol 同名类型的字段子集。
 *
 * 故意不直接 import `FileBlockRecord` 类型：避免 telemetry 包反向依赖
 * sandbox-cli protocol（保持依赖方向：tools / orchestrator → telemetry）。
 *
 * 字段：
 * - `path` 文件绝对路径（不脱敏，按业务上报需要全文上报）
 * - `actionMask` 操作 bitmask：0x01=READ, 0x02=WRITE, 0x04=DELETE, 0x08=EXECUTE
 *   解码为人类可读字符串走 [`decodeFileActionMask`] helper
 */
export interface FileBlockRecordLike {
    path: string;
    actionMask: number;
}
/**
 * 单条网络拦截记录的窄接口 —— sandbox-cli-protocol 同名类型的字段子集。
 *
 * 字段：
 * - `host` 被拦截的域名 / IP（不脱敏）
 * - `port` 端口（可选）
 * - `protocol` 协议（"tcp" / "udp" / "dns" 等；与 sandbox-cli-protocol 字段名保持一致）
 * - `actionMask` 操作 bitmask：0x01=CONNECT, 0x02=DNS_RESOLVE, 0x04=SENDTO
 *   解码为人类可读字符串走 [`decodeNetworkActionMask`] helper
 */
export interface NetworkBlockRecordLike {
    host: string;
    port?: number;
    protocol: string;
    actionMask: number;
}
