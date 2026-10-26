import { Logger } from '@celljs/core';
import { type ModifyBackupCommittedPayload, type SafeDeleteBulkApprovalPayload, type SandboxDaemonFailurePayload, type SandboxDaemonStartupFinishedPayload, type SandboxInterceptType, type SandboxSafetyTogglePayload, type SandboxStatus, type SandboxThreatDatabaseHitPayload, type SandboxThreatDatabaseLoadPayload, type SandboxThreatDatabaseUnavailableReason, type SandboxToolCallOutcome, type SandboxTurnStatePayload, type SecurityReviewApprovalPayload, type SecurityReviewModelCallPayload, type SecurityReviewResultProtectionPayload, type SecurityReviewToolCallPayload, type ToolCallInterceptPayload, type ToolCallNativeRerunPayload, type ToolCallOutcomePayload, type ToolCallSandboxFirstRunPayload } from '@genie/telemetry';
import { GalileoService } from '../galileo/galileo-protocol';
import type { ReportEventRequest } from '../sandbox-cli/sandbox-cli-protocol';
import { type SandboxExecResultLike, SandboxTelemetryReporter } from './sandbox-telemetry-protocol';
/**
 * `SandboxTelemetryReporter` 默认实现。
 *
 * 实现注意事项：
 * - 每个 `report*` 方法直接构造伽利略 attribute 对象（语义化 key，零 JSON 序列化），
 *   并同步写入 OTel 本地 buffer；实际网络导出由 Galileo BatchProcessor 异步完成，
 *   不返回可被主链路等待的 Promise。
 * - 字段长度护栏：errorMsg 等可能超长的字段在 reporter 内部截断到位。
 * - 报错容错：序列化或 GalileoService 任一环节失败，记 warn 后吞掉，不影响主流程。
 *
 * 上报通路：
 * - 业务字段统一通过 `GalileoService.logInfo / logError` 落到伽利略 logs。
 * - 失败 / 超时（status ∈ {failed, timeout}）走 `logError`，其余走 `logInfo`。
 *   伽利略后台日志级别可直接当告警入口。
 */
export declare class SandboxTelemetryReporterImpl implements SandboxTelemetryReporter {
    protected readonly galileoService: GalileoService;
    protected readonly logger: Logger;
    reportSecurityReviewToolCall(payload: SecurityReviewToolCallPayload): void;
    reportSecurityReviewModelCall(payload: SecurityReviewModelCallPayload): void;
    reportSecurityReviewApproval(payload: SecurityReviewApprovalPayload): void;
    reportSecurityReviewResultProtection(payload: SecurityReviewResultProtectionPayload): void;
    reportTurnState(payload: SandboxTurnStatePayload): void;
    reportSandboxSafetyToggle(payload: SandboxSafetyTogglePayload): void;
    reportDaemonStartupFinished(payload: SandboxDaemonStartupFinishedPayload): void;
    /**
     * 上报 daemon 失败事件，兼容 main 历史 phase 并覆盖 5.3.x 新 phase
     * （详见 `SandboxDaemonFailurePayload`）。
     * undefined 字段被 `_buildAttributes` 自动剔除。
     */
    reportDaemonFailure(payload: SandboxDaemonFailurePayload): void;
    /**
     * 上报命令进入沙箱后的首跑结果。`status` 只承载日志严重级：
     * 基础设施异常进 logError，其余业务结果进 logInfo，业务结论看 `result`。
     */
    reportToolCallSandboxFirstRun(payload: ToolCallSandboxFirstRunPayload): void;
    /**
     * 上报沙箱首跑后的 native 重跑结果。`status` 只承载日志严重级：
     * native 执行基础设施异常进 logError，其余业务执行结果进 logInfo。
     */
    reportToolCallNativeRerun(payload: ToolCallNativeRerunPayload): void;
    /**
     * 上报真正向用户弹出授权弹窗的拦截场景（带用户最终 decision）。
     *
     * 由 `SandboxOrchestrator` 在新权限路径真正展示弹窗、拿到 `decision` 后调用；
     * auto-approve（零弹窗）与未拦截命令都不触发。`status` 恒为 `failed`。
     */
    reportToolCallIntercept(payload: ToolCallInterceptPayload): void;
    /**
     * 上报 safe-delete 批量删除保护审批结果。它复用授权 UI，但业务含义不是
     * 沙箱权限拦截，因此独立成事件；用户拒绝也是正常审批结果，status 仍为 success。
     */
    reportSafeDeleteBulkApproval(payload: SafeDeleteBulkApprovalPayload): void;
    /**
     * 命令终局全链路上报。`status` 由 `(outcome, reason)` 派生：仅**策略硬拦**
     * （`forbidden` / `system-tool-blocked`）的 `deny` → failed（logError，留作安全
     * 审计告警入口）；**用户主动拒绝**的 deny 及其余结局 → success（logInfo），避免
     * 把正常用户拒绝灌进告警流。详见 {@link outcomeToStatus}。
     */
    reportToolCallOutcome(payload: ToolCallOutcomePayload): void;
    reportModifyBackupCommitted(payload: ModifyBackupCommittedPayload): void;
    /** 上报威胁库加载进 sandbox-cli 的结果；底层 _emit 已吞掉全部上报异常。 */
    reportThreatDatabaseLoad(payload: SandboxThreatDatabaseLoadPayload): void;
    /**
     * 上报一次恶意域名命中；底层 `_emit` 已吞掉全部上报异常。
     *
     * 命中是防护成功生效，`status` 恒为 `success`——不能因为「拦了」就记 failed，否则告警
     * 通道会被正常防护行为填满。拦截量与风险类型分布按 tags 聚合。
     */
    reportThreatDatabaseHit(payload: SandboxThreatDatabaseHitPayload): void;
    /**
     * sandbox-cli 通过反向事件 `ReportEvent` 上送的原始 envelope 入口。
     *
     * 当前没有任何 scene/action 需要翻译成伽利略事件，全部丢弃。`sandbox_projfs.mount`
     * 由 sandbox-cli 每次 OpenSession 主动上送，静默丢弃避免刷 warn；其余未知
     * scene/action 仍写 warn，便于发现协议漂移。
     */
    ingestRawEvent(envelope: ReportEventRequest): void;
    /**
     * 构造 attribute 并写入 Galileo 本地 OTel buffer。
     *
     * - 自动剔除 undefined value（保持 attribute 紧凑，伽利略后台"日志转指标"
     *   配规则时按 dim 切片更干净）
     * - SDK 类型 `Attributes` 是 `Record<string, string>`——number / boolean
     *   会被 GalileoService 内部 normalizeAttributes 统一转字符串，业务侧无感
     * - 失败 / 超时进 logError，其余进 logInfo
     * - 字段构造和本地入队任一阶段失败都静默吞掉，不向调用方返回 Promise
     *
     * 这里刻意不再套 `setImmediate`：`GalileoService.logInfo / logError` 只执行本地
     * BatchProcessor 入队，网络导出本来就是异步的。额外延后一轮会让退出 flush 看不到
     * 尚未入队的最后一批事件，造成尾部少报。
     */
    private _emit;
    /**
     * 从统一字段清单提取最终关联 ID。这里不读取 SessionManager：事件可能在异步
     * callback 中结算，必须使用调用方在事件入口固化的快照，避免多 Session 串值。
     */
    private _pickCorrelationAttributes;
    /** 诊断日志独立测试缝；生产把 telemetry 自身的 warn 延后，避免影响调用栈。 */
    protected _scheduleTelemetry(task: () => void): void;
    /**
     * 构造伽利略 attributes：把 status / module 升格为 attribute、剔除 undefined / null value。
     *
     * `module='sandbox'` 是所有沙箱事件共享的一等切片维度——伽利略后台直接用
     * `{tags.module="sandbox"}` 一键聚合所有沙箱事件，不必走 `message =~ "sandbox\\..*"`
     * 正则。注入点放在 _buildAttributes 这一公共出口，所有最终调用 `_emit` 的 reporter
     * 方法全部命中，调用方零感知；`ingestRawEvent` 当前只丢弃原始 envelope，不经过这里。
     */
    private _buildAttributes;
    /**
     * 截断 errorMsg 到 1KB 字节长度上限。
     *
     * UTF-8 字节长度计数（避免中文等多字节字符在边界处被截成乱码）。
     * 截断时 `logger.warn` 一次（不输出原文，避免日志爆量）。
     */
    private _truncateMessage;
    private _truncateField;
    private _warnSafely;
    /**
     * UTF-8 安全截断：按字节数截但不切断多字节字符。
     *
     * 实现：先按 `maxBytes` 切 Buffer，然后用 `TextDecoder('utf-8', { fatal: false })`
     * 解码并丢弃尾部 `\uFFFD` 替换字符。
     */
    private _truncateUtf8;
}
/**
 * errorMsg 字段字节上限（跨事件统一）。
 */
export declare const ERROR_MESSAGE_MAX_BYTES = 1024;
/** 解码文件拦截 actionMask（导出供 reporter 内部和单测使用）。 */
export declare function decodeFileActionMask(mask: number): string;
/** 解码网络拦截 actionMask（导出供 reporter 内部和单测使用）。 */
export declare function decodeNetworkActionMask(mask: number): string;
/**
 * 由命令终局 `(outcome, reason)` 派生伽利略 severity 状态。
 *
 * - `deny` 且 `reason` ∈ 策略硬拦（`forbidden` / `system-tool-blocked`）→ `failed`
 *   （logError，留作安全审计告警入口：有人在跑被禁命令）
 * - `deny` 其余（**用户主动拒绝**：`user-denied` / `bypass-user-denied` /
 *   `sensitive-denied` / `system-tool-rejected` / `command-safety-ask-denied`）→
 *   `success`（logInfo）——拒绝是正常用户行为，不该灌进告警流
 * - `allow` / `prompt-allow` / `error` / `dispatched` → `success`（logInfo）；
 *   `error`（命令自挂/异常）、`dispatched`（后台未裁决）同样刻意不进错误流
 *
 * 注意：`status` 只承载日志级别（severity），不承载放通/拒绝语义——放通率、拒绝率
 * 一律按 `tags.outcome` 统计，不依赖 `status`。
 */
export declare function outcomeToStatus(outcome: SandboxToolCallOutcome, reason?: string): SandboxStatus;
/**
 * 由威胁库加载结果派生伽利略 severity 状态。
 *
 * 只有 `sync-failed` 进 `failed`/logError 告警通道——那是「DB 已经在本地、却没能
 * 加载进 sandbox-cli」，属真实故障。其余不生效原因是预期状态，进 logInfo：
 *
 * - `no-db-path`：daemon 还没发布首个 DB。新装用户必然先经历这段窗口，按失败上报
 *   会让告警通道被开箱即用的正常样本淹没，真实加载故障反而看不出来。
 * - `lifecycle-unavailable`：沙箱未启用或生命周期缺失。用户关掉沙箱是正常配置，
 *   且本轮沙箱覆盖率由 `sandbox.turn_sandbox_cli_usage.recorded` 回答，不靠本事件。
 * - `disabled`：用户主动关闭了恶意域名拦截。
 * - `protocol-unsupported`：当前 sandbox-cli 版本不认这条命令。版本落后期间每一轮都会命中，
 *   按失败上报等于用一个可预期的过渡态把告警通道占满。这类样本按 `tags.reason` 单独看即可。
 *
 * 与 {@link outcomeToStatus} 同理：`status` 只承载日志级别，防护是否生效一律按
 * `tags.available` 与 `tags.reason` 统计，不依赖 `status`。
 */
export declare function threatDatabaseLoadToStatus(available: boolean, reason?: SandboxThreatDatabaseUnavailableReason): SandboxStatus;
/**
 * 由 fileBlock / networkBlock 数量判定 interceptType。
 *
 * - 两类都非空 → 'mixed'
 * - 仅 fileBlock → 'file'
 * - 仅 networkBlock → 'network'
 * - 均无 → 'none'
 */
export declare function deriveInterceptType(result: SandboxExecResultLike): SandboxInterceptType;
