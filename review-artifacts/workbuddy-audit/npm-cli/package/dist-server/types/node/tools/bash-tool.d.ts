import { Logger } from '@celljs/core';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { PluginManager } from '../../vendor/cbc-plugins/node/index.js';
import { FunctionCallItem, ToolArg, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import type { RunContext, ToolExecuteArgument } from '@openai/agents';
import { z } from 'zod';
import { type AcpTerminalPublisher } from '../acp/acp-protocol';
import { BackgroundTaskNotifier } from '../agent-task/agent-task-protocol';
import { BashSandboxManager } from '../bash-sandbox';
import { ToolResultBlobService } from '../blob-store/tool-result-blob-service';
import { EndpointProvider } from '../loopback/server-protocol';
import { type SandboxOrchestrator as ISandboxOrchestrator, type SandboxPermissionGateway as ISandboxPermissionGateway } from '../permission';
import { SettingsManager } from '../settings';
import { ShellService } from '../shell';
import { ShortcutManager } from '../shortcut/shortcut-protocol';
import { BaseTool } from './base-tool';
import { type ShellStreamPusherService } from './shell-stream-pusher';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const BashParameters: z.ZodObject<{
    readonly command: z.ZodString;
    readonly timeout: z.ZodOptional<z.ZodNumber>;
    readonly description: z.ZodOptional<z.ZodString>;
    readonly run_in_background: z.ZodOptional<z.ZodBoolean>;
    readonly dangerouslyDisableSandbox: z.ZodOptional<z.ZodBoolean>;
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
type BashInput = z.infer<typeof BashParameters>;
export declare class BashTool extends BaseTool implements Tool {
    protected readonly shellService: ShellService;
    protected readonly sandboxOrchestrator: ISandboxOrchestrator;
    protected readonly sandboxPermissionGateway: ISandboxPermissionGateway;
    protected readonly shortcutManager: ShortcutManager;
    protected readonly logger: Logger;
    protected readonly shellStreamPusher: ShellStreamPusherService;
    protected readonly sandboxManager: BashSandboxManager;
    protected readonly settingsManager: SettingsManager;
    protected readonly pluginManager?: PluginManager;
    protected readonly toolResultBlobService: ToolResultBlobService;
    protected readonly backgroundTaskNotifier: BackgroundTaskNotifier;
    protected readonly endpointProvider: EndpointProvider;
    /**
     * 尝试解析 service proxy 端点 URL。
     * server 模式下立即可得；非 server 模式（TUI/SDK）下 deferred 永不解锁；
     * 库模式取宿主经 start({ serviceProxy }) 提供的地址。
     * @returns URL 字符串，解析失败返回 null
     */
    private resolveServiceProxyUrl;
    /**
     * ACP v2 终端推送器。惰性解析而非 @Autowired：纯 TUI / SDK 运行时不会加载 acp 模块，
     * 此时容器里没有这个绑定，取不到就整体降级为不推送。
     */
    private terminalPublisherRef?;
    protected shouldUsePty(session: Session | undefined): boolean;
    protected get terminalPublisher(): AcpTerminalPublisher | undefined;
    /**
     * 把一段终端输出投给 ACP 客户端。三个 spawn 路径（file-fd poller / pipe onOutput /
     * 前台促升）最终都汇到这里，所以门控与异常吞噬只需要在一处成立。
     *
     * 整段自吞异常：推送是旁路观测，绝不能让它影响命令执行。
     *
     * @param bytes `Buffer` = 来自文件的原始字节（字节保真）；`string` = 来自 PTY / pipe
     *              的解码结果（保真度较弱，见各调用点说明）。
     */
    private publishTerminalOutput;
    /** 促升路径用：任务还没促升时 task 为 undefined，天然不推。 */
    private publishBackgroundOutput;
    name: ToolNames;
    aliases: string[];
    /**
     * Tool schema is a **method** (not a static field) so ToolManager.get()
     * re-evaluates it per invocation against the current process env. When
     * CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS is truthy the `run_in_background`
     * field is omitted, so the model never sees it (issue #63114 — background
     * shell results cannot flow back in request-response SDK / print-mode
     * consumers, so the host disables the capability outright). The runtime
     * guard in `execute()` still coerces `run_in_background=true` from
     * stale/cached tool calls back to foreground.
     */
    parameters(): z.ZodTypeAny;
    /**
     * On Windows, BashTool requires Git Bash. If Git Bash is not installed,
     * this tool is disabled and PowerShellTool becomes the sole shell tool.
     */
    isEnabled: () => boolean;
    argumentRenderer: ToolCallArgumentRenderer;
    resolveNeedPermissionArgs(_runContext: RunContext, input: BashInput, _callId?: string): ToolArg[];
    /** Auto mode classifier projection: the command is the action's risk surface. */
    toAutoClassifierInput(input: unknown): string;
    /** Read-only foreground commands may run alongside sibling read-only calls (Claude Code parity). */
    isConcurrencySafe(input: unknown): boolean;
    needsApproval: (runContext: RunContext<Session>, input: ToolExecuteArgument<any>, callId?: string) => Promise<boolean>;
    execute(input: BashInput, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    private executeCommand;
    private executeForeground;
    private createExecutionContext;
    private createShellPromise;
    private createBackgroundPromise;
    /**
     * shell-service 超时触发时的处理：尝试把命令转为后台任务而不是 kill。
     *
     * 对齐 Claude Code 的 `shellCommand.onTimeout → startBackgrounding` 行为
     * (src/tools/BashTool/BashTool.tsx:967-971)。返回 true 告诉 shell-service "已接管,
     * 不要 SIGTERM"，子进程继续跑；返回 false 走原 kill 路径（向后兼容老行为）。
     *
     * 关闭条件：
     *   - env CODEBUDDY_BASH_AUTO_BACKGROUND_DISABLED=1 → 全局关闭
     *   - print 模式（-p，非 stdio stream-json）→ 禁止（#61140，进程随主 turn 退出无法续跑后台任务）
     *   - 命令在 auto-background 黑名单内（如 `sleep`） → 按原路径 kill
     *   - execCtx.promoteToBackground 未就绪（理论上不会发生）
     */
    private tryPromoteToBackgroundOnTimeout;
    private handleBackgroundedResult;
    private buildForegroundResult;
    /**
     * 后台任务输出文件大小看门狗的扫描间隔。
     */
    private static readonly BG_SIZE_WATCHDOG_INTERVAL_MS;
    /**
     * 后台任务 stdout+stderr 总大小上限，超过则 SIGKILL（防写爆磁盘）。
     * 默认 50MB；可通过 env `CODEBUDDY_BASH_BG_MAX_OUTPUT_BYTES` 调整。
     * 参考 Claude Code `ShellCommand.ts:239-261` 的 size watchdog 机制。
     */
    private static readonly BG_DEFAULT_MAX_OUTPUT_BYTES;
    private getBgMaxOutputBytes;
    /**
     * 给当前后台任务分配一对 stdout/stderr 落盘文件 + fd，用于直接接收子进程的 stdio。
     *
     * 返回 `null` 表示当前路径不适合走文件 fd（例如要走 sandbox 后端，
     * IPC 协议不消费 fd），调用方应回退到 onOutput pipe 模式。
     *
     * 实际的"建目录 + 开 fd"逻辑抽到 {@link prepareBackgroundOutputFiles}（独立 module）
     * 以便单测；此方法只做"是否走文件 fd"的策略判断。
     */
    private maybePrepareBackgroundOutputFiles;
    private executeInBackground;
    /** 关 fd 的小工具；忽略已关闭/无效错误。spawn 之后必须立刻调用，不要让父进程持有写端。 */
    private closeFdSafely;
    private createBackgroundTask;
    /**
     * 晋升路径的终端退出通知。任务未晋升（execCtx.currentBackgroundTask 为空）时静默跳过。
     *
     * 任何终止分支都必须调用：`exitStatus` 是客户端判定"已结束"的唯一依据，漏一条就会让
     * 卡片永远停在运行中。
     */
    private notifyTerminalExit;
    private updateBackgroundTaskStatus;
    /**
     * 收集本次命令声明的产物，并就地打完相关告警。
     *
     * 唯一来源是 `$CODEBUDDY_ARTIFACTS` 带外通道；stdout 不再被解析（原因见
     * produced-artifact.ts 模块头）。
     *
     * 只返回 artifacts。malformed 不上抛是有意的：它唯一的用途就是告警，作者看不到
     * 这个文件，被跳过的行只能靠日志暴露。
     */
    private collectDeclarations;
    private buildBackgroundResult;
    private startStreamingUpdates;
    private stopStreamingUpdates;
    private createStreamingText;
    private pushStreamingText;
    private cleanup;
    private shouldAutoApproveInSandbox;
    validateRuntimeInput(input: unknown): ToolResult | undefined;
    private validateInput;
    private errorResult;
    /**
     * 把参数校验类的失败原因映射到 8000 段细分错误码：
     * 命令根无法识别（权限/解析域）→ 8014，其余保持 90000。
     */
    private resolveBashValidationErrorCode;
    /**
     * 根据 shell 执行结果推导结构化错误码。
     * 返回 '0' 表示成功（无错误），非零纯数字为错误码。
     */
    private resolveBashErrorCode;
    private findCallId;
    private getCommandRoot;
    /**
     * shell-quote 抛错时的命令根兜底：按空白切分，跳过前导环境变量赋值，取第一个
     * 非空 token 的 basename。用于 heredoc 写文件等 shell-quote 无法解析、但完全合法
     * 的命令，保证它们仍能被识别命令根并正常执行，而不是让整轮 run 崩溃。
     */
    private getCommandRootFallback;
    private isEnvAssignment;
    private generateTaskId;
    private resolveTimeout;
    /**
     * Build a SandboxApprovalRequester that surfaces SandboxOrchestrator
     * approval prompts through the standard InterruptionService flow.
     *
     * The full implementation lives in `bash-sandbox-approval-requester.ts`
     * — this method is a thin shim that injects the tool's logger.
     */
    private _createApprovalRequester;
    /**
     * Emit a single structured log line summarising the orchestrator outcome,
     * so it is easy to grep for bypass decisions during diagnostics.
     */
    private _logOrchestratorOutcome;
}
export {};
