/**
 * Hook mechanism protocol definitions
 * Compatible with Claude Code hooks specification
 */
import type { HookInput, InternalHookContext } from '../../vendor/cbc-core/node/index.js';
import { HookEvent, type HookExecutionOptions, type HookExecutionResult, type PromptHookResult } from '../../vendor/cbc-shared/node/index.js';
export { HookBlockedError, HookEvent, NotificationType } from '../../vendor/cbc-shared/node/index.js';
export type { BackgroundTaskInfo, CronTaskInfo, FinalStopReason, HookBlockingDetail, HookExecutionOptions, HookExecutionResult, HookOutput, HookPermissionMode, PromptHookResult, SessionEndReason, SessionStartSource, } from '../../vendor/cbc-shared/node/index.js';
/**
 * Events that don't require matcher configuration
 * These events will skip the matcher panel and match all hooks
 */
export declare const EVENTS_WITHOUT_MATCHER: HookEvent[];
/**
 * Hook event input/output behavior descriptions for matcher panel
 */
export declare const HOOK_EVENT_IO_DESCRIPTIONS: Record<HookEvent, string[]>;
export declare const HOOK_EVENT_TITLES: Record<HookEvent, string>;
/**
 * Hook configuration for a specific event
 */
export interface HookConfig {
    /**
     * Regular expression to match tool names or event criteria
     * Example: "Write|Edit" matches Write or Edit tools
     * Use "*" to match all tools/events (same as empty string or undefined)
     *
     * Optional for events that don't require matching:
     * - UserPromptSubmit, Notification, Stop, SubagentStop: matcher is not used
     * - SessionStart: matches against 'source' field (startup|resume|clear|compact)
     * - SessionEnd: matches against 'reason' field (clear|logout|prompt_input_exit|other)
     * - PreCompact: matches against 'trigger' field (manual|auto)
     * - PreToolUse, PostToolUse: matches against tool_name
     */
    matcher?: string;
    /**
     * List of hooks to execute when matcher matches
     */
    hooks: HookDefinition[];
}
/**
 * Hook 定义的基础接口
 */
interface BaseHookDefinition {
    /**
     * 超时时间（秒），默认 60 秒
     * 兼容 Claude Code 规范
     */
    timeout?: number;
    /**
     * 插件根目录（可选）
     * 由插件加载器设置，用于 CODEBUDDY_PLUGIN_ROOT 环境变量
     */
    pluginRoot?: string;
    /**
     * Hook 来源命名空间（可选，用于 dedupe 去重）
     *
     * 由 hook 加载器在注入时设置，标记该 hook 是从哪个 source 来的。约定：
     *  - settings.json (user / project / local) 来源 → 不设置（统一空 namespace），
     *    所以不同 scope 中的同一条命令会被折叠成一份（CC parity:
     *    `pluginRoot ?? skillRoot ?? ''`）。
     *  - plugin 来源 → 通常等于 pluginRoot（同一插件内同名 hook 折叠，
     *    不同插件的同名 hook 因 sourceId 不同而保留各自一份，避免
     *    `${PLUGIN_ROOT}/hook.sh` 这种模板被错误折叠）。
     *  - frontmatter agent / skill 来源 → ScopedHookRegistry 注入的 scopeId
     *    （每个子 agent / skill 实例独立 namespace）。
     *
     * 此字段仅参与 dedupe key 计算，不会下发到 hook 子进程。
     */
    sourceId?: string;
    /**
     * 插件数据目录（可选，Claude Code 兼容）
     * 由插件加载器设置，用于 CLAUDE_PLUGIN_DATA / CODEBUDDY_PLUGIN_DATA 环境变量
     */
    pluginData?: string;
    /**
     * 插件用户配置（可选，Claude Code 兼容）
     * 由插件加载器设置；每个 key 都会展开为 CLAUDE_PLUGIN_OPTION_{KEY} 环境变量
     */
    pluginOptions?: Record<string, string | boolean | number>;
    /**
     * Permission rule 语法条件（可选，Claude Code 兼容）
     * - Bash(git *) — 工具名是 Bash 且命令匹配 git *
     * - Write(*.ts) — 工具名是 Write 且路径匹配 *.ts
     * 仅对 tool 相关事件（PreToolUse/PostToolUse/PermissionRequest/PermissionDenied）生效；
     * 不匹配时该 hook 被跳过。
     */
    if?: string;
    /**
     * 执行时 UI 显示的状态提示文案（可选）
     */
    statusMessage?: string;
    /**
     * 成功执行一次后是否在当前进程内销毁（可选）
     * 仅在内存中记录，settings.json 不会被改写。
     */
    once?: boolean;
    /**
     * 异步 hook（fire-and-forget）
     * 若 hook stdout 返回 `{"async":true,...}` 自动生效；字段级声明仅用于静态配置提示。
     */
    async?: boolean;
    /**
     * 异步 hook 在 exit code 2 时唤醒模型继续对话（可选）
     */
    asyncRewake?: boolean;
    /**
     * 允许透传给 hook 子进程的环境变量白名单（可选）
     * command / http 两种 hook 都遵守此名单；未命中的变量不会泄漏到 hook。
     * 同时影响 headers 字段内的 $VAR 插值解析。
     */
    allowedEnvVars?: string[];
}
/**
 * Command Hook 定义 - 执行 shell 命令
 */
export interface CommandHookDefinition extends BaseHookDefinition {
    /**
     * Hook 类型 - command 类型执行 shell 命令
     */
    type: 'command';
    /**
     * 要执行的 shell 命令
     * 出于安全考虑，建议使用绝对路径
     */
    command: string;
    /**
     * 执行 command 使用的 shell（可选，Claude Code 兼容）
     * - 'bash' — 走 getShellConfiguration()，默认
     * - 'powershell' — 走 pwsh / powershell.exe
     */
    shell?: 'bash' | 'powershell';
}
/**
 * Prompt Hook 定义 - 使用 LLM 评估条件
 *
 * Prompt Hook 允许用户使用自然语言定义 hook 逻辑。
 * LLM 评估 prompt 并返回 JSON 决策：
 * - { "ok": true } - 允许操作继续
 * - { "ok": false, "reason": "..." } - 阻止操作并说明原因
 *
 * 支持所有 hook 事件，最适用于：
 * - Stop/SubagentStop: 智能判断 agent 是否应继续工作
 * - UserPromptSubmit: 使用 LLM 验证用户输入
 * - PreToolUse: 基于上下文做出权限决策
 *
 * @example
 * {
 *   "type": "prompt",
 *   "prompt": "检查代码是否包含中文注释。如果发现则返回 {\"ok\": false}。"
 * }
 */
export interface PromptHookDefinition extends BaseHookDefinition {
    /** Runtime-only owner; a session goal must not evaluate another chat's Stop. */
    sessionId?: string;
    /** Runtime instance owner; persisted session IDs can be loaded more than once. */
    session?: HookInput['session'];
    /**
     * Hook 类型 - prompt 类型使用 LLM 评估
     */
    type: 'prompt';
    /**
     * 发送给 LLM 进行评估的 prompt。
     *
     * Prompt 应描述要检查的条件和期望的响应格式。
     * Hook 参数（tool_input、prompt 内容等）会自动追加到末尾，
     * 除非在 prompt 中使用了 $ARGUMENTS 占位符。
     *
     * 期望的 LLM 响应格式：
     * - { "ok": true } - 条件满足，允许操作
     * - { "ok": false, "reason": "..." } - 条件不满足，阻止并说明原因
     * - { "ok": false, "impossible": true, "reason": "..." } - 条件不可能满足
     */
    prompt: string;
    /**
     * 用于此 hook 的模型 ID（可选）
     * 如果未指定，使用用户的默认模型
     */
    model?: string;
    /**
     * 当 LLM 返回 `{ok: false, impossible: true}` 时，hook 不再阻塞 stop，
     * 让模型自然停下，并视作"目标不可达成"。仅运行时代码内注册时设置；
     * settings.json / plugin / frontmatter 解析出来的 hook 不会有此字段。
     *
     * 用于 /goal 这类 stop-condition hook：当 LLM 判定条件永远无法满足时，
     * 应该停止循环 block 而不是无限重试。
     */
    treatImpossibleAsAllow?: boolean;
    /**
     * 当 hook 评估结束（无论 ok / not-ok / impossible）时被调用的回调。
     * 仅运行时代码内注册时设置，用于 /goal 等内部 feature 接收评估结果，
     * 实现"自动注销 hook + UI 提示"等副作用。
     *
     * settings.json / plugin / frontmatter 解析出来的 hook 不会有此字段。
     */
    onResult?: (result: PromptHookResult, input: HookInput) => void | Promise<void>;
    /**
     * 当 prompt hook 返回 ok=false 时，是否让 Agent 继续工作而不是停止。
     * 设为 true 时行为类似 /goal：ok=false 的 reason 会注入对话历史，
     * Agent 继续循环直到条件满足。
     *
     * 仅对 Stop/SubagentStop 事件有意义。
     * 用户可在 settings.json / frontmatter 中配置此字段。
     */
    continueOnBlock?: boolean;
}
/**
 * Agent Hook 定义（Claude Code 兼容）
 *
 * Agent Hook 让一个子 agent 运行 prompt 来判断/执行副作用。
 * 与 Prompt Hook 的区别：Agent Hook 可使用工具（完整 agent loop），
 * Prompt Hook 仅做二元判断。
 */
export interface AgentHookDefinition extends BaseHookDefinition {
    /** Hook 类型 - agent */
    type: 'agent';
    /** 调度给 agent 执行的 prompt */
    prompt: string;
    /** 指定使用的 agent 类型（可选，默认 general-purpose） */
    agentType?: string;
    /** 用于此 hook 的模型 ID（可选，覆盖 agent 默认） */
    model?: string;
}
/**
 * HTTP Hook 定义（Claude Code 兼容）
 *
 * 将 hook input JSON POST 到 url，响应 body 作为 HookOutput 解析。
 * headers 支持 `$VAR` 插值，仅限 allowedEnvVars 白名单内变量。
 */
export interface HttpHookDefinition extends BaseHookDefinition {
    /** Hook 类型 - http */
    type: 'http';
    /** 请求目标 URL */
    url: string;
    /** 额外 HTTP 请求头；value 支持 $VAR / ${VAR} 插值 */
    headers?: Record<string, string>;
    /** HTTP 方法，默认 POST */
    method?: 'POST' | 'PUT' | 'PATCH';
}
/**
 * Hook 定义 - 可以是 command / prompt / agent / http 四种类型
 */
export type HookDefinition = CommandHookDefinition | PromptHookDefinition | AgentHookDefinition | HttpHookDefinition;
/**
 * Input data passed to hook script via stdin
 * Format matches Claude Code hooks specification exactly
 */
export { Hook, type HookInput, HookPriority } from '../../vendor/cbc-core/node/hooks/hook-protocol.js';
/**
 * Hook Manager interface
 */
export declare const HookManager: unique symbol;
export interface HookManager {
    /**
     * Execute hooks for a specific event
     *
     * @param event - The hook event type
     * @param input - Input data to pass to hooks
     * @param options - Execution options (timeout, env, hookEvent for UI, etc)
     * @returns Execution result indicating whether to proceed
     */
    executeHooks(event: HookEvent, input: HookInput, options?: HookExecutionOptions, internalContext?: InternalHookContext): Promise<HookExecutionResult>;
    /**
     * Check if any hooks are configured for an event
     *
     * @param event - The hook event type
     * @param toolName - Optional tool name to match against
     * @returns True if hooks are configured
     */
    hasHooks(event: HookEvent, toolName?: string): Promise<boolean>;
    /**
     * Get all configured hooks for an event
     *
     * @param event - The hook event type
     * @returns Array of hook configs
     */
    getHooks(event: HookEvent): Promise<HookConfig[]>;
}
/**
 * Hook Executor interface - executes individual hook commands
 */
export declare const HookExecutor: unique symbol;
export interface HookExecutor {
    /**
     * Execute a single hook command
     *
     * @param command - Shell command to execute
     * @param input - Input data to pass via stdin
     * @param options - Execution options (timeout, env vars)
     * @returns Execution result
     */
    execute(command: string, input: HookInput, options?: HookExecutionOptions): Promise<HookExecutionResult>;
}
/**
 * Prompt Hook Service 接口
 * 负责执行基于 LLM 的 Prompt Hook
 */
export declare const PromptHookService: unique symbol;
export interface PromptHookService {
    /**
     * 执行 Prompt Hook
     *
     * @param hook - Prompt Hook 定义
     * @param input - Hook 输入数据
     * @param options - 执行选项
     * @returns Prompt Hook 执行结果
     */
    execute(hook: PromptHookDefinition, input: HookInput, options?: PromptHookExecuteOptions): Promise<PromptHookResult>;
}
/**
 * Prompt Hook 执行选项
 */
export interface PromptHookExecuteOptions {
    /**
     * 超时时间（毫秒）
     */
    timeout?: number;
    /**
     * 是否包含对话历史（Stop Hook 需要）
     */
    includeHistory?: boolean;
}
/**
 * HookInputProcessor enriches HookInput before hooks are dispatched.
 *
 * Register implementations with @Component(HookInputProcessor).
 * All processors are collected via @AutowiredProvider and executed
 * in priority order (lower = earlier) at the start of executeHooks().
 */
export declare const HookInputProcessor: unique symbol;
export interface HookInputProcessor {
    /**
     * Execution priority (lower values execute first)
     */
    readonly priority: number;
    /**
     * Enrich or transform the HookInput before hook execution.
     * Processors mutate the input object in place.
     */
    process(input: HookInput, event: HookEvent): Promise<void>;
}
/**
 * Options for registering hooks with a scope.
 */
export interface ScopedHookRegisterOptions {
    /**
     * When true, `Stop` event hooks are auto-converted to `SubagentStop` because
     * subagent completion fires SubagentStop rather than Stop.
     * Aligns with CC `registerFrontmatterHooks.ts:40-44`.
     */
    isAgent?: boolean;
    /**
     * Human-readable label for logging, e.g. "agent 'code-reviewer'" or
     * "skill 'commit'".
     */
    sourceLabel: string;
}
/**
 * Scope-scoped hook registry.
 *
 * The 5th hook source (alongside settings / plugins / @Component(Hook) / SDK).
 * Lets agent / skill frontmatter hooks be registered for the duration of a
 * scope (typically a subagent session / fork subagent) and auto-cleaned when
 * the scope ends.
 *
 * Aligns with Claude Code's `addSessionHook` / `removeSessionHook` pair.
 */
export declare const ScopedHookRegistry: unique symbol;
export interface ScopedHookRegistry {
    /**
     * Register hooks under a scope id. Safe to call multiple times for the
     * same scopeId — later calls replace the previous registration.
     *
     * @param scopeId Usually the subagent session id
     * @param hooks Parsed HookSettings (from frontmatter or other sources)
     * @param options Registration options (isAgent / sourceLabel)
     */
    register(scopeId: string, hooks: Record<string, HookConfig[] | undefined>, options: ScopedHookRegisterOptions): void;
    /**
     * Unregister all hooks under a scope id. Also clears any `onceFired`
     * entries tied to the scope's HookDefinition references.
     */
    unregister(scopeId: string): void;
    /**
     * Get all active hook configs for an event across all registered scopes.
     * Used by HookManager.getHooks as the 5th hook source.
     */
    getHooks(event: HookEvent): HookConfig[];
    /**
     * Check whether a scope is currently registered (for tests / diagnostics).
     */
    hasScope(scopeId: string): boolean;
}
