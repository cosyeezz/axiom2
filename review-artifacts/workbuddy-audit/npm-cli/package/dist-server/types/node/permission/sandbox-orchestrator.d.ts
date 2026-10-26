import { Logger } from '@celljs/core';
import { type Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { Workspace } from '@genie/runtime';
import type { DecisionRecord } from '@genie/sandbox-cli/protocol';
import { type BashSandboxManager as IBashSandboxManager } from '../bash-sandbox/bash-sandbox-protocol';
import { type CommandParserService as ICommandParserService } from '../command-parser/command-parser-protocol';
import { type ISandboxCLILifecycle } from '../sandbox-cli/sandbox-cli-lifecycle-protocol';
import { type SandboxRuleSyncService as ISandboxRuleSyncService } from '../sandbox-cli/sandbox-rule-sync-service';
import { SandboxTurnConfig } from '../sandbox-cli/sandbox-turn-config';
import { type SandboxCenterIpcClient } from '../sensitive-content/sandbox-center-ipc-client-protocol';
import { type ShellService } from '../shell/shell-protocol';
import { type SandboxTelemetryReporter as ISandboxTelemetryReporter } from '../telemetry/sandbox-telemetry-protocol';
import { type FileSafetyOperation } from '../utils/security-audit-log';
import { type RiskAssessment } from './file-policy-assessment';
import { type SandboxAuditService as ISandboxAuditService } from './sandbox-audit-service';
import { type SandboxExecPolicy as ISandboxExecPolicy } from './sandbox-exec-policy-protocol';
import { type SandboxOrchestrator as ISandboxOrchestrator, type SandboxOrchestratorParams, type SandboxOrchestratorResult, type SandboxTelemetryContext } from './sandbox-orchestrator-protocol';
export declare function resolveSingleFileApprovalOperation(assessments: readonly RiskAssessment[], decisionRecords?: readonly DecisionRecord[]): Exclude<FileSafetyOperation, 'access'> | undefined;
/**
 * 在 execute 入口捕获执行所属会话，权限判断、审批记录和审计均使用同一会话。
 * 权限读取所属 session 的当前设置，不使用 telemetry 中的派生值。
 */
export interface SandboxOrchestratorAuthority {
    readonly session: Session;
    readonly conversationRequestId?: string;
    readonly permissionMode?: string;
    readonly useSandboxCLI: boolean;
    readonly telemetry: SandboxTelemetryContext;
}
export declare function captureSandboxOrchestratorAuthority(session: Session | undefined, turnConfig: Pick<SandboxTurnConfig, 'useSandboxCLI'>, telemetryContext?: SandboxTelemetryContext): SandboxOrchestratorAuthority | undefined;
/**
 * Codex-style sandbox execution orchestrator.
 *
 * Owns the "sandbox-first, bypass on approval" policy described in
 * `apps/workbuddy-desktop/docs/refactor/win-cli-sandbox/18-codex-alignment-plan.md`:
 *
 *   1. If the tool call carries `dangerouslyDisableSandbox=true`, surface an
 *      approval UI up-front and go straight to the local shell on consent.
 *   2. Consult the in-session approval store for an `allow_session` decision
 *      keyed by `(canonicalCommand, cwd)` and short-circuit to local
 *      execution on hit.
 *   3. Otherwise run the command under `SandboxShellService`. Successful runs
 *      return immediately.
 *   4. When the sandboxed attempt fails due to real sandbox denials
 *      (`sandboxDenied`), request approval. Deny → return the failing
 *      sandboxed handle; allow → store the approval for `allow_session`,
 *      reset caller-held output buffers via `onSandboxRetryStart`, and
 *      re-run through `LocalShellService`.
 */
export declare class SandboxOrchestratorImpl implements ISandboxOrchestrator {
    protected readonly localShellService: ShellService;
    protected readonly sandboxShellService: ShellService;
    protected readonly sessionManager: SessionManager;
    protected readonly sandboxTurnConfig: SandboxTurnConfig;
    /** 每次 execute 的所属会话与归因信息，异步等待后不再读取全局当前会话。 */
    private readonly authorities;
    private _authority;
    protected readonly workspace: Workspace;
    protected readonly commandParser: ICommandParserService;
    protected readonly bashSandboxManager: IBashSandboxManager;
    protected readonly execPolicy: ISandboxExecPolicy;
    protected readonly auditService?: ISandboxAuditService;
    protected readonly telemetryReporter?: ISandboxTelemetryReporter;
    protected readonly sandboxCenterClient?: SandboxCenterIpcClient;
    protected readonly sandboxRuleSyncService?: ISandboxRuleSyncService;
    protected readonly sandboxLifecycle?: ISandboxCLILifecycle;
    protected readonly logger: Logger;
    /**
     * 记录本次 `execute()`（以 `params` 对象身份为 key）是否已产生过命令终局
     * （`_finalizeOutcome` 调用过）。异常兜底据此去重——已出终局后再抛异常
     * 不再补 `exec-exception`，保证「一条命令最多一条 outcome」。
     */
    private readonly _outcomeReported;
    /**
     * 记录本次 `execute()` 在产生终局**之前**已经真正向用户弹过一次授权窗、但
     * 该弹窗本身没有出终局、命令继续往下跑的情况（当前来源：Center 命令 ask
     * 或内置 unsafe-find-delete，`allow_once` 批准后继续跑沙箱）。`_finalizeOutcome` 据此把后续任意
     * 终局（sandbox-ok / 零弹窗 auto-approved 等）的
     * `prompted` 修正为 `true`——否则这些「已打扰过用户」的命令会被误记成
     * `prompted=false`，污染减扰率 KPI。
     */
    private readonly _preExecApprovals;
    /** 每次 execute 共享同一个 Center 策略解析上下文与命令裁决。 */
    private readonly _centerPolicies;
    private _centerPolicy;
    /**
     * 全链路入口：包一层 catch-all 守住「全漏斗」——只有当命令**还没产生任何
     * 权限终局**就抛出未捕获异常（如沙箱进程 spawn 失败 / wait 崩溃 / 授权回调
     * 异常等基础设施故障）时，才补一条 `stage='exception'`、`outcome='error'`、
     * `reason='exec-exception'` 的兜底终局；若已出终局（如已 auto-approved 再
     * 本地重跑时抛错），则不重复上报。无论是否补报，异常都原样向上抛。
     *
     * 注意：异常属基础设施故障而非命令业务终局，`outcome='error'` 走 logInfo 不进
     * 告警流（详细诊断由 `sandbox.daemon.failure` 承接）；放通率分母默认剔除
     * `reason='exec-exception'`。
     */
    execute(params: SandboxOrchestratorParams): Promise<SandboxOrchestratorResult>;
    private _executeInternal;
    /**
     * 系统级工具策略分流。
     *
     * 返回 `SandboxOrchestratorResult` 时表示已处理（disabled / always_confirm）；
     * 返回 `undefined` 表示 `auto_execute`，交由后续正常沙箱流程处理。
     */
    private _handleSystemToolPolicy;
    /**
     * Build a synthetic failure handle for commands forbidden by
     * {@link SandboxExecPolicy}. No shell is spawned, no approval UI is shown.
     *
     * The result looks like a command that failed with exitCode=1 and an
     * explanatory stderr message; `sandboxDenied` is set so upstream callers
     * that inspect the flag see a consistent "sandbox-enforced failure",
     * while `sandboxEscalationDenied` prevents any downstream logic from
     * attempting to re-prompt the user.
     */
    private _handleForbidden;
    private _handlePreExecBypass;
    /**
     * 命中 Center allow 规则的命令是静默放行的，终局只会落泛化的 `sandbox-executed`，
     * 无法回答「是哪条规则放的行」。这里补一条带 matchedRule 的 allow-matched，
     * 与 ask/deny 网关的审计口径对齐。
     */
    private _auditCenterCommandAllowMatches;
    private _auditConfiguredNetworkAllowMatches;
    private _buildAuditContext;
    private _commandForLocalUse;
    private _localShellCommand;
    private _createPreExecApprovalTelemetry;
    /**
     * 保证严格模式拦截一定带一条模型可见的网络记录（genie/genie#122764）。
     *
     * Seatbelt 对 blanket deny 上报的是**规则**的地址过滤器而非目的地址，`host`
     * 可能缺失；而投影层（`projectNetworkDecision`）要求 host 非空——缺 host 时
     * 记录掉进 `unmappedDecisionRecords`，模型只剩内核的 `Operation not permitted`，
     * 连「被系统层拦了」这个事实都看不到。
     *
     * 目标缺失时用 `unknown` 兜底：提示的价值远高于目标精确性（与审计侧
     * `network-strict.blocked` 用 `unknown` 落库同口径）。
     * 已有严格模式记录时原样返回，不重复注入。
     */
    private _ensureStrictModeNetworkRecords;
    private _appendSandboxOutcomeAuditLog;
    private _handleCommandSafetyAskGate;
    private _handleCommandSafetyDenyGate;
    private _buildCommandSafetyAskApprovalKey;
    private _buildPostExecRequest;
    private _handlePostExecCommandAsk;
    /**
     * Handle post-exec escalation for the new permission path.
     *
     * Called when the attribution analyzer concludes `sandbox_denied` — the
     * command failed because the sandbox blocked actionable file operations.
     *
     *   1. Consume complete native file decisions; missing coverage needs approval.
     *   2. If every file decision allows access → Native re-run, zero prompts.
     *   3. If any block is explicitly denied → keep the sandbox failure, zero prompts.
     *   4. If any block `needs_approval` → delegate to the approval UI.
     *      The UI only shows `needs_approval` items (D18: reduce cognitive load).
     *   5. auto-approve does NOT write to ApprovalStore (D17: system judgement ≠ user auth).
     */
    private _handlePostExecEscalation;
    private _handleSafeDeleteBulkConfirmEscalation;
    private _resolveSafeDeleteBulkFilePolicy;
    private _buildSafeDeleteBulkTargetFileBlocks;
    private _extractSafeDeleteBulkCommandTargetCandidates;
    private _resolveSafeDeleteBulkTargetPath;
    private _getTelemetryCorrelation;
    /**
     * 上报 safe-delete 批量删除保护审批结果。
     *
     * 这类弹窗复用授权 UI，但不是沙箱文件 / 网络权限拦截，因此不能复用
     * `sandbox.tool_call.intercept`。
     */
    private _reportSafeDeleteBulkApproval;
    private _persistSafeDeleteBulkApproval;
    private _persistSafeDeleteBulkRejection;
    /**
     * 一次性读取 side-channel 信号文件 + stderr 兜底，返回统一的检测结果。
     * 信号文件优先（不受 PTY 输出塌缩影响），读完即删。
     */
    private _detectBulkGuardSignal;
    private _readBulkGuardSignalFile;
    private _asUserDeniedBulkResult;
    private _handleSafeDeleteFailClosedEscalation;
    /**
     * 上报沙箱首跑结果。该事件只描述“命令进入沙箱后的第一次执行事实”，
     * 不表达最终放行 / 拒绝；终局仍由 `_finalizeOutcome` 负责。
     */
    private _reportSandboxFirstRun;
    /**
     * 上报 `sandbox.tool_call.intercept`（真正向用户弹出授权弹窗的拦截场景）。
     *
     * 与 `sandbox_first_run` / `outcome` 复用同名公共字段（toolName /
     * interceptType / exitCode / conversationId / conversationRequestId）便于
     * 后台跨事件 join；`decision` 是本事件特有维度。
     *
     * `toolName` 由工具层透传（orchestrator 本身 tool-agnostic）。
     */
    private _reportIntercept;
    /**
     * 命令终局的**唯一出口**：本地审计日志 + 上报 `sandbox.tool_call.outcome`
     * （贯穿 pre-exec + post-exec 全链路的命令终局事件）+ 标记本次已出终局。
     *
     * 合并了原 `_logOutcome`（本地日志）与 `_reportOutcome`（伽利略上报）两个出口，
     * 保证 reason 只写一次、不漂移，且每个终止点必然同时落本地日志与远端事件。
     * 在 `execute()` 的每个终止点恰好调用一次，提供完整漏斗与分母，与
     * `_reportIntercept`（真实弹窗子集）互补。
     *
     * `stage` / `outcome` 优先用调用方显式传入，否则从 `REASON_STAGE_OUTCOME`
     * 静态映射表按 `reason` 补齐；若 reason 未登记且未显式给值，按 `exception/error`
     * 兜底并 warn（绝不静默落成 pre-exec/allow 污染放通率）。
     * `toolName` 取值口径同 `_reportIntercept`。
     * reporter 未注入时跳过上报但仍落本地日志、仍标记终局；上报异常被兜住、不影响主链路。
     */
    private _finalizeOutcome;
    private _logTelemetryDiagnostic;
    /**
     * 推导零弹窗自动批的放通凭据（best-effort 取主因）。
     *
     * 优先级（强→弱）：
     * 1. `command-allowlist`  —— 命令 allow 名单**实际把一条本应弹窗的 block 降级放通**
     *                      （`commandAllowDowngradedCount > 0`）；若仅冗余命中（路径
     *                      本就 low）则不记此项，落到 `baseline-low-risk`，避免高估其贡献
     * 2. `full-access-medium` —— bypass(fullAccess) 模式下放通了 🟡 medium（仅显式 medium 规则会触发）
     * 3. `file-allowlist`     —— 命中用户文件 allowlist（user-allowlist 规则）
     * 4. `baseline-low-risk` —— 全部 🟢 low（显式低风险规则）
     */
    private _deriveAutoApproveReason;
    /**
     * 取一组风险评估里的最高风险等级；空集返回 undefined。
     */
    private _maxRiskLevel;
    private _resolveFilePolicyRuleSources;
    private _appendFileSafetyDecisionAuditLog;
    /**
     * Convert macOS `sed -i` temporary deny paths (`/.!<pid>!<name>`) back to
     * the user-facing target path for file-safety audit readability.
     *
     * Example:
     *   /Users/alice/.!79171!t.py -> /Users/alice/t.py
     */
    private _resolveFileSafetyAuditPath;
    /**
     * Re-run a command natively after sandbox denial + approval / auto-approve.
     *
     * Resets caller-side buffers via `onSandboxRetryStart` so the retry output
     * replaces the first-attempt output, then runs locally.
     *
     */
    private _nativeRerun;
    private _wrapNativeRerunHandle;
    private _buildNativeRerunPayload;
    private _scheduleNativeRerunReport;
    private _reportNativeRerun;
    /**
     * Map the session's {@link PermissionMode} to the sandbox policy's
     * {@link ExecutionMode} (`'default'` or `'bypass'`).
     *
     * Unrestricted sessions (`fullAccess`, or bypass + `CODEBUDDY_IS_SANDBOX`)
     * → `'bypass'` (🟡 medium auto-approved). Everything else
     * (including plain `bypassPermissions`) → `'default'`.
     */
    private _resolveExecutionMode;
    private _shouldEscalate;
    /**
     * Mirrors `SandboxShellService.execute`'s cwd resolution: join the first
     * workspace folder (or `process.cwd()`) with the caller-supplied relative
     * `cwd`. Keeps the approval cache key identical to the cwd the shell
     * backend will actually use.
     */
    private _resolveCwd;
    private _getSessionApproval;
    private _isSessionApproved;
    /**
     * Decide whether the orchestrator should attempt the sandbox path.
     *
     * Single source of truth: `settings.sandbox.enabled` in
     * `.codebuddy/settings.local.json` (or the user-level `settings.json`).
     * Both entry points — the TUI `/sandbox` panel and the Desktop
     * `SandboxConfigBar` toggle — write this same setting (the Desktop path
     * via `AcpAgent.setSessionConfigOption(configId='sandbox')`).
     *
     * Rationale for the settings-only approach:
     *   - Persists across CLI sidecar restarts (the Desktop app can respawn
     *     the agent-cli child process transparently).
     *   - Avoids the `session.useSandboxCLI` in-memory override that silently
     *     diverged from settings when the sidecar was restarted mid-session.
     *   - Project-level scope matches user intent: "this workspace runs in
     *     sandbox" rather than "just this one conversation".
     */
    private _readSandboxConfig;
    private _isSandboxEnabled;
    private _persistApprovedPostExecAsks;
    private _storeApproval;
    private _runLocal;
}
