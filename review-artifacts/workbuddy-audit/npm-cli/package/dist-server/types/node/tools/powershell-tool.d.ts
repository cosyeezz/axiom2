import { Logger } from '@celljs/core';
import { Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { FunctionCallItem, ToolArg, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import type { RunContext, ToolExecuteArgument } from '@openai/agents';
import { z } from 'zod';
import { type AcpTerminalPublisher } from '../acp/acp-protocol';
import { BackgroundTaskNotifier } from '../agent-task/agent-task-protocol';
import { ToolResultBlobService } from '../blob-store/tool-result-blob-service';
import { type SandboxOrchestrator as ISandboxOrchestrator, type SandboxPermissionGateway as ISandboxPermissionGateway } from '../permission';
import { SettingsManager } from '../settings';
import { ShortcutManager } from '../shortcut/shortcut-protocol';
import { type SandboxTelemetryReporter as ISandboxTelemetryReporter } from '../telemetry/sandbox-telemetry-protocol';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
type ShellServiceType = import('../shell/index.js').ShellService;
type BashSandboxManagerType = import('../bash-sandbox/bash-sandbox-protocol.js').BashSandboxManager;
export declare const RESOLVED_PS_MAX_TIMEOUT_MS = 600000;
export declare const RESOLVED_PS_DEFAULT_TIMEOUT_MS = 120000;
declare const PowerShellParameters: z.ZodObject<{
    command: z.ZodString;
    timeout: z.ZodOptional<z.ZodNumber>;
    description: z.ZodOptional<z.ZodString>;
    run_in_background: z.ZodOptional<z.ZodBoolean>;
    dangerouslyDisableSandbox: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    command: string;
    timeout?: number | undefined;
    description?: string | undefined;
    run_in_background?: boolean | undefined;
    dangerouslyDisableSandbox?: boolean | undefined;
}, {
    command: string;
    timeout?: number | undefined;
    description?: string | undefined;
    run_in_background?: boolean | undefined;
    dangerouslyDisableSandbox?: boolean | undefined;
}>;
type PowerShellInput = z.infer<typeof PowerShellParameters>;
export declare class PowerShellTool extends BaseTool implements Tool {
    protected readonly shortcutManager: ShortcutManager;
    protected readonly logger: Logger;
    protected readonly settingsManager: SettingsManager;
    protected readonly toolResultBlobService: ToolResultBlobService;
    protected readonly shellService: ShellServiceType;
    protected readonly sandboxOrchestrator: ISandboxOrchestrator;
    protected readonly sandboxTelemetryReporter?: ISandboxTelemetryReporter;
    protected readonly sandboxPermissionGateway: ISandboxPermissionGateway;
    protected readonly sessionManager: SessionManager;
    protected readonly backgroundTaskNotifier: BackgroundTaskNotifier;
    protected readonly bashSandboxManager: BashSandboxManagerType;
    /**
     * ACP v2 终端推送器。惰性解析而非 @Autowired：纯 TUI / SDK 运行时不会加载 acp 模块，
     * 此时容器里没有这个绑定，取不到就整体降级为不推送。与 BashTool 同款。
     */
    private terminalPublisherRef?;
    protected get terminalPublisher(): AcpTerminalPublisher | undefined;
    /**
     * 发一条终端创建通知。整段自吞异常：这是尽力而为的旁路观测，绝不能让它的失败
     * 掀翻已经 spawn 成功的后台任务（与 BashTool 的两处 try/catch 强度对齐）。
     *
     * `command` 传的是**脱敏后**的命令：`redactPowerShellCommand` 的产物同时用于
     * `task.title`，上 wire 的那份必须同源，否则会把内联凭据推给客户端。
     */
    private notifyTerminalCreated;
    /**
     * 发一条终端退出通知。任何终止分支都必须调用：`exitStatus` 是客户端判定"已结束"
     * 的唯一依据，漏一条就会让卡片永远停在运行中。
     */
    private notifyTerminalExit;
    /**
     * 把一段后台输出投给 ACP 客户端。
     *
     * 保真度：PowerShell 的后台执行没有文件 fd 通道，输出一律经 ConPTY / child_process
     * 解码成字符串后才到这里，原始字节在上游就没了，只能重新编码回 UTF-8。这与
     * BashTool 的 pipe 兜底路径同级，弱于 BashTool 的 file-fd 通道（那条是字节保真）。
     * 不是 bug，是已知取舍——前台链路本就需要字符串去拼 ToolResult。
     */
    private publishTerminalOutput;
    name: ToolNames;
    aliases: string[];
    /**
     * Dynamic schema (method, not static field) so ToolManager.get()
     * re-evaluates it against the current env. When
     * CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS is truthy the `run_in_background`
     * field is omitted from what the model sees (issue #63114). The runtime
     * guard in `execute()` coerces stale/cached `run_in_background=true` back to
     * foreground. Note: the foreground-timeout auto-background path is a
     * separate lifecycle safeguard and is not governed by this env.
     */
    parameters(): z.ZodTypeAny;
    argumentRenderer: ToolCallArgumentRenderer;
    /**
     * Only enabled on Windows when PowerShell is available.
     */
    isEnabled: () => boolean;
    resolveNeedPermissionArgs(_runContext: RunContext, input: PowerShellInput, _callId?: string): ToolArg[];
    /** Auto mode classifier projection: the command is the action's risk surface. */
    toAutoClassifierInput(input: unknown): string;
    /** Read-only foreground commands may run alongside sibling read-only calls (Claude Code parity). */
    isConcurrencySafe(input: unknown): boolean;
    needsApproval: (runContext: RunContext<Session>, input: ToolExecuteArgument<any>, callId?: string) => Promise<boolean>;
    execute(input: PowerShellInput, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    private executeCommand;
    private executeForeground;
    /** 补齐未进入 Orchestrator 的 PowerShell 本机执行路由，不参与执行控制。 */
    private _scheduleDirectNativeOutcome;
    private _logOutcomeTelemetryFailure;
    /**
     * Route PowerShell execution through the SandboxOrchestrator. The
     * orchestrator owns the sandbox-first / bypass-on-approval policy, so this
     * method's job is limited to:
     *   - wrapping the user command into the `pwsh -NoProfile -NonInteractive -Command "..."`
     *     form that sandbox-cli executes with `rawCommand: true`;
     *   - routing the orchestrator's approval requests through
     *     `session.interruptionSubject` so the Desktop UI (SandboxInterceptCard)
     *     picks them up;
     *   - shaping the resulting ShellResult into the PowerShell tool's
     *     `buildResult`-equivalent output.
     */
    private executeForegroundViaOrchestrator;
    /**
     * 后台执行走 Orchestrator，对齐 Bash 后台的实现。
     * 构建 rawCommand（pwsh -Command "..."）交给 orchestrator.execute()，
     * 拿到 handle 后用 handle.wait() 追踪完成状态。
     */
    private executeInBackgroundViaOrchestrator;
    /**
     * Construct an approval requester that surfaces orchestrator prompts via
     * the standard RunToolApprovalItem flow. Mirrors BashTool's requester but
     * renders under the `PowerShell` tool name so the UI can label correctly.
     */
    private _createApprovalRequester;
    private executeInBackground;
    /**
     * 创建 BackgroundTask 并注册到 ToolManager / session.backgroundTaskSubject。
     * 供前台超时自动后台化、Ctrl+B 转后台、显式 run_in_background 三条路径共用。
     *
     * NOTE: 与 BashTool 的 `createBackgroundTask` 实现重叠约 80%，后续独立 PR 抽出
     * `ShellToolBase` 基类统一（见 task #10）。
     */
    private registerBackgroundTask;
    /**
     * 翻 BackgroundTask 终态并推送完成事件。
     *
     * **必须**由调用方传入 task 启动时的 session 快照（`sessionAtRegister`），
     * 不能在这里 `sessionManager.sessionSubject.value` 即时读 —— 后台任务跨 turn
     * 完成时 session 可能已被切走，即时读会把通知推到错误的会话或丢失。
     * 对齐 `BackgroundTaskNotifier` 文档承诺："传入的 session 必须是 task 启动时所在的那个"。
     */
    private updateBackgroundTaskStatus;
    private buildBackgroundResult;
    private spawnPowerShellPty;
    private spawnPowerShell;
    private buildResult;
    validateRuntimeInput(input: unknown): ToolResult | undefined;
    private invalidInputResult;
    private errorResult;
    private generateTaskId;
    /**
     * Build a model-readable description of sandbox interception, mirroring
     * BashTool's `Append sandbox intercept information` block. Returns an
     * empty string when no interception happened, so the foreground orchestrator
     * path can append it conditionally without leaking noise into normal runs.
     *
     * Cases:
     * - `sandboxDenied + sandboxEscalationDenied` → user explicitly rejected
     *   the approval prompt; tell the model so it stops retrying silently.
     * - `sandboxDenied` with a non-zero exit → sandbox blocked the operation;
     *   model should adjust approach.
     * - `fileBlockRecords` / `networkBlockRecords` without `sandboxDenied` →
     *   non-blocking intercepts (e.g. `strip_write` that didn't surface as a
     *   denial); attach as informational so the model knows side effects may
     *   not have happened.
     */
    private _buildSandboxInterceptInfo;
}
export {};
