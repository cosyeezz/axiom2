import type { FileApprovalScope, SandboxRuleContext } from '@genie/agent-client-protocol';
import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { SandboxCorrelationFields, SandboxTurnDisabledReason } from '@genie/telemetry';
import type { SafeDeleteBulkConfirmInfo } from '../shell/safe-delete';
import type { ShellExecuteParams, ShellExecutionHandle, ShellResult } from '../shell/shell-protocol';
/** DI symbol for the sandbox orchestrator. */
export declare const SandboxOrchestrator: unique symbol;
/**
 * Why a particular invocation ended up bypassing the sandbox.
 *
 * - `dangerously-disable-sandbox` — model explicitly asked for bypass and the
 *   user approved the request before first execution (Codex `RequireEscalated`).
 * - `session-approved` — this (canonical command, cwd) was previously approved
 *   with `allow_session`; we skipped the first sandboxed attempt entirely.
 * - `escalation-approved` — first attempt failed inside the sandbox with real
 *   denials; the user approved post-exec escalation with `allow_once` or
 *   `allow_session` and we re-ran outside the sandbox.
 * - `exec-policy-allow` — {@link SandboxExecPolicy} classified the command as
 *   known-safe (builtin or user allow rule), so we ran it locally without
 *   any sandbox attempt or approval UI.
 */
export type SandboxBypassReason = 'dangerously-disable-sandbox' | 'session-approved' | 'escalation-approved' | 'exec-policy-allow' | 'system-tool-approved';
/**
 * Context the UI layer needs to render a SandboxInterceptCard.
 *
 * `pre-exec` is raised for model-requested bypass (`dangerouslyDisableSandbox`)
 * before any execution; `post-exec` is raised after the sandbox rejected the
 * first attempt and we need user consent to retry without the sandbox.
 */
export interface SandboxApprovalRequest {
    ruleContext?: SandboxRuleContext;
    fileApprovalScope?: FileApprovalScope;
    /** Trusted host-side target used for Center revalidation; never forwarded to UI metadata. */
    fileApprovalTargetPath?: string;
    /** Native sandbox session, which may be the parent of the logical approval session. */
    fileApprovalSandboxSessionId?: string;
    /** Captured native-session epoch; stale pending requests cannot grant after restart/close. */
    fileApprovalSessionGeneration?: number;
    /** Raw command the model wants to execute (not canonicalised). */
    command: string;
    /** Canonicalised command string — same value used as the cache key. */
    canonicalCommand: string;
    /** Absolute cwd the command will run in. */
    cwd: string;
    /** Distinguishes first-time bypass request from post-denial escalation. */
    mode: 'pre-exec' | 'post-exec';
    /**
     * For `post-exec`: the ShellResult returned by the sandboxed attempt.
     * For `pre-exec`: undefined.
     */
    sandboxResult?: ShellResult;
    /**
     * When `true`, this approval request was raised by the new permission
     * path's sandbox policy (Center verdict or local bulk approval). The
     * `requestApproval` callback should **not** perform a second
     * `CommandUtils.checkCommandSafety` check and must surface the
     * approval UI unconditionally.
     *
     * When absent or `false`, the legacy CommandUtils-based auto-approval
     * logic in `_createApprovalRequester` is still applicable.
     */
    sandboxPolicyEvaluated?: boolean;
    /** false 表示审批只授权本次操作，不得将 allow_session 复用于其他排队调用。 */
    sessionApprovalReusable?: boolean;
    /**
     * Optional legacy/future pre-exec sensitive-command metadata. The current
     * new sandbox path does not set this field; credential paths are handled by
     * native file rules and Center verdicts.
     */
    sensitiveCommandInfo?: SensitiveCommandInfo;
    /**
     * 沙箱拦截原因，用于在审批卡片中显示可读的拦截说明。
     *
     * - `file-external`    — 命令试图修改工作空间外部文件，被沙箱拦截。
     * - `file-blocklist`   — 命令试图访问用户在安全中心配置的黑名单路径。
     * - `command-rule-ask` — 命令命中安全中心的询问规则。
     *
     * 仅拦截类审批设置。普通有序命令 ask 仍不设此字段，卡片用模型描述。
     * `unsafe-delete` 是 pre-exec：不安全删除（当前为 find -delete）。
     * post-exec 沙箱拦截用于区分文件和网络原因；pre-exec 命令询问规则
     * 使用 `command-rule-ask`，以便审批卡片展示准确的命中原因。
     */
    interceptReason?: 'file-external' | 'file-blocklist' | 'file-rule-ask' | 'network-external' | 'command-rule-ask' | 'bulk-delete-threshold' | 'unsafe-delete';
    /** 文件询问规则对应的明确操作；混合或无法识别时不设置。 */
    fileOperation?: 'read' | 'write' | 'delete';
    bulkDeleteInfo?: SafeDeleteBulkConfirmInfo;
    /**
     * HTTP 明文拦截弹窗所需信息。仅拦截成因为 `http_intercept_ask` 时设置
     * （post-exec 网络拦截的子集），用于构造审批卡片的 target/description 文案。
     */
    httpInterceptInfo?: SandboxHttpInterceptInfo;
}
/**
 * HTTP 明文拦截弹窗信息。由 `sandbox-orchestrator` 的 post-exec 网络拦截
 * 审批路径填充（`networkBlockRecords` 中 reason='http_intercept_ask' 的记录），
 * 供 `bash-sandbox-approval-requester` 构造 HTTP 专属的审批卡片文案。
 */
export interface SandboxHttpInterceptInfo {
    /** 拼接的 HTTP URL，形如 `http://host[:port]`，用于弹窗文案展示。 */
    url: string;
}
/**
 * Extra context attached to a {@link SandboxApprovalRequest} for legacy/future
 * sensitive-command approval flows.
 */
export interface SensitiveCommandInfo {
    /** Human-readable reason for the sensitive-command prompt. */
    reason: string;
    /** The credential paths that were matched. */
    matchedPaths: string[];
}
/** The approval choice returned by the UI or an automatic approval path. */
export type SandboxApprovalChoice = 'allow_once' | 'allow_session' | 'deny';
/** Where an approval choice came from. */
export type SandboxApprovalSource = 'user' | 'auto';
/** The approval result for a sandbox approval request. */
export type SandboxApprovalDecision = SandboxApprovalChoice | {
    decision: SandboxApprovalChoice;
    source: SandboxApprovalSource;
    /** True only after an actual capable ACP response and native directory grant. */
    fileDirectoryApprovalGranted?: boolean;
};
/** Callback supplied by the tool layer to surface the approval UI. */
export type SandboxApprovalRequester = (request: SandboxApprovalRequest) => Promise<SandboxApprovalDecision>;
/** ToolCall 入口固化的上报关联上下文；任何字段都不得参与执行或审批决策。 */
export interface SandboxTelemetryContext extends SandboxCorrelationFields {
    agentType?: 'main' | 'sub-agent';
    turnSandboxDisabledReason?: SandboxTurnDisabledReason;
}
/** Parameters for {@link SandboxOrchestrator.execute}. */
export interface SandboxOrchestratorParams {
    /** Shell params to forward to whichever backend ultimately runs. */
    shellParams: ShellExecuteParams;
    /**
     * 执行所属会话（权限判断、审批记录与埋点）。Server/多会话入口必须显式传入；
     * CLI 缺省时在 execute 入口捕获当前会话，等待审批后不再重新读取全局槽位。
     */
    session?: Session;
    /**
     * Absolute cwd used as part of the approval cache key. When omitted, the
     * orchestrator resolves `shellParams.cwd` against the current workspace
     * folder — matching the cwd that `SandboxShellService` would compute — so
     * tests that want deterministic keys should pass this explicitly.
     */
    cwd?: string;
    /**
     * Model-level bypass request. When true, we skip the sandboxed first
     * attempt and go straight to the approval UI; user consent means we run
     * with `LocalShellService`.
     */
    dangerouslyDisableSandbox: boolean;
    /** Callback that shows the approval UI and resolves with the user's choice. */
    requestApproval: SandboxApprovalRequester;
    /** 仅供上报区分真实 UI 与自动决策；不参与审批结果。 */
    approvalUiAvailable?: boolean;
    /** ToolCall 入口固化的旁路上报上下文；不得参与任何执行或审批判定。 */
    telemetryContext?: SandboxTelemetryContext;
    /**
     * When true, the orchestrator skips all pre-exec checks (ExecPolicy
     * forbidden/allow and dangerouslyDisableSandbox pre-exec approval UI),
     * going directly to sandbox execution + post-exec escalation only.
     *
     * Used by the new permission system to implement "pure post-exec approval":
     * no command is pre-judged or pre-blocked — everything enters the sandbox
     * first, and the user is only prompted after the sandbox reports a denial.
     */
    skipPreExecChecks?: boolean;
    /**
     * The user-facing command **before** any tool-level wrapping.
     *
     * PowerShellTool wraps the model's command into
     * `pwsh.exe -NoProfile -NonInteractive -Command "..."`, making the
     * actual intent invisible to canonicalization when it only sees
     * `shellParams.command`.
     *
     * When set, the orchestrator uses this value for:
     *   - {@link canonicalizeCommand} (produce a stable approval-cache key
     *     that doesn't depend on the PowerShell executable path)
     *   - safety checks and audit records that need the user-facing command.
     */
    originalCommand?: string;
    /** Parse PowerShell with the same executable selected for sandbox execution. */
    powerShellPath?: string;
    /**
     * 后台执行模式。为 true 时，orchestrator 在沙箱内启动命令后立即返回
     * handle，跳过 await sandboxHandle.wait() 及后续的归因分析和提权流程。
     * 沙箱拒绝的操作会直接导致命令失败，不弹提权窗。
     *
     * 适用于 run_in_background 场景：pre-exec 安全检查（SystemToolPolicy、
     * ExecPolicy、有序命令 ask 等）照常执行，只跳过 post-exec 阶段。
     */
    background?: boolean;
    /**
     * Logical tool name that drove this execution (`'Bash'` | `'PowerShell'` | `'Grep'`).
     *
     * Threaded through to `sandbox.tool_call.*` telemetry as `tags.toolName`
     * so BI can split metrics by tool. The orchestrator is
     * tool-agnostic and cannot infer this on its own, so the tool layer must
     * pass it. Optional for non-tool callers (tests / internal) — absent means
     * the attribute is simply not reported.
     */
    toolName?: string;
}
/** Result of {@link SandboxOrchestrator.execute}. */
export interface SandboxOrchestratorResult {
    /** The live execution handle the caller should `await .wait()` on. */
    handle: ShellExecutionHandle;
    /** True iff the command ended up executing outside the sandbox. */
    bypassed: boolean;
    /** Populated iff `bypassed` is true. */
    bypassReason?: SandboxBypassReason;
    /**
     * The `ShellResult` from the sandboxed first attempt, when one occurred.
     * Useful for diagnostics and for callers that want to differentiate
     * "failed in sandbox, then bypassed" from "failed after bypass".
     */
    sandboxAttemptResult?: ShellResult;
}
export interface SandboxOrchestrator {
    /**
     * Run a shell command applying the Codex-style
     * "sandbox-first, bypass on approval" policy.
     *
     * Implementations must:
     *   1. If `dangerouslyDisableSandbox`, ask the user first and either run
     *      locally (bypass) or reject.
     *   2. Consult the session's `SandboxApprovalStore` for a cached
     *      `allow_session` approval and skip straight to local execution on
     *      hit.
     *   3. Otherwise attempt the command in the sandbox. Return the handle
     *      immediately for successful attempts.
     *   4. On post-exec denial (see `_parseFileBlockRecords`), request
     *      approval. On `deny` return the sandboxed (failing) handle; on
     *      `allow_*` drop the first-attempt buffers, update the store for
     *      `allow_session`, and run locally.
     *
     * Thrown errors propagate to the caller; approval timeouts should be
     * surfaced by `requestApproval` itself.
     */
    execute(params: SandboxOrchestratorParams): Promise<SandboxOrchestratorResult>;
}
