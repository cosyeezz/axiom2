import type { BackgroundTask, InternalHookContext, PromptCacheStability, Session, SubagentLifecycleSnapshot } from '../../vendor/cbc-core/node/index.js';
import { type Agent, type AgentInputItem, type ApprovalScope, type FunctionCallItem, type PermissionMode, type PermissionUpdate, type RuleValue, type RunContext, type RunToolApprovalItem, type ToolArg, type ToolExecuteArgument, type ToolPermissionResult } from '../../vendor/cbc-shared/node/index.js';
import type { Agent as ProductAgent, Command as ProductCommand, LanguageModel, ModelVideoGeneration, ProductConfiguration, Skill as ProductSkill } from '@genie/product';
import type { ToolInputParameters as AgentsCoreToolInputParameters } from '@openai/agents-core';
import { z } from 'zod';
import type { McpTool } from '../mcp/mcp-protocol';
import type { SensitiveProtectionMetadata, ToolEgressReviewRequest } from '../sensitive-content/sensitive-content-protocol';
import type { BaseTool } from './base-tool';
import type { FileChangeArtifact } from './file-change-artifact';
import type { ProducedArtifact } from './produced-artifact';
import type { ToolCallTarget } from './tool-call-boundary';
export declare const ToolArgIgnoreKey: string[];
export declare const Tool: unique symbol;
export declare const ToolManager: unique symbol;
export declare const ToolPermissionStrategy: unique symbol;
export declare const ToolArgumentRewriteService: unique symbol;
export declare const ReadFileStateService: unique symbol;
export declare const ToolAlwaysApprovalService: unique symbol;
export declare const ToolPermissionService: unique symbol;
/**
 * Which original checks the Bash command gate stacks on (issue #139526):
 * - `hooks`: only PreToolUse hooks — the sandbox path, and legacy-path commands that
 *   sandbox auto-approval lets through;
 * - `permission`: the full permission chain (hooks + permission rules) of the legacy path.
 */
export type CommandGateBaseline = 'hooks' | 'permission';
export declare const MAX_TOOL_OUTPUT_LENGTH = 50000;
export declare const DEFAULT_SLASH_COMMAND_TOOL_CHAR_BUDGET = 8000;
export declare const DEFAULT_SKILL_TOOL_CHAR_BUDGET = 8000;
export declare const DEFAULT_AGENT_TOOL_CHAR_BUDGET = 30000;
/** Per-entry hard cap for a single skill's description */
export declare const MAX_SKILL_DESC_CHARS = 200;
/** Minimum maxDescLen below which non-protected skills degrade to names-only (aligned with CC MIN_DESC_LENGTH=20) */
export declare const MIN_SKILL_DESC_LENGTH = 20;
/**
 * Env name for per-skill description hard-cap overrides.
 *
 * By default every skill's description is hard-capped to {@link MAX_SKILL_DESC_CHARS}(200)
 * per entry. A host can loosen (or tighten) this cap for **specific** skills — identified
 * by skill name — without changing the global default, by exporting this env.
 *
 * Format: a JSON object mapping skill name → maxChars, e.g.
 *   `{"workbuddy-office-routing":300,"tencent-pptx":300}`
 * The value is the per-entry cap that fully replaces the default for the named skill.
 * Explicitly overridden skills are also excluded from the later total-budget redistribution,
 * so an updated bundled skill keeps the same host-selected limit when its source becomes plugin.
 * Because keys are JSON strings, skill names containing a colon (plugin skills are named
 * `plugin:skill`) work without any special escaping. Entries whose value is not a positive
 * integer, and non-object / malformed JSON, are ignored. See {@link parseSkillDescMaxOverrides}.
 *
 * agent-cli owns this generic mechanism; business skill names are injected by hosts
 * (e.g. workbuddy-server CLI env builders) — agent-cli never hard-codes them.
 */
export declare const SKILL_DESC_MAX_OVERRIDES_ENV = "CODEBUDDY_SKILL_DESC_MAX_OVERRIDES";
/**
 * Parse the {@link SKILL_DESC_MAX_OVERRIDES_ENV} raw value into a `skillName → maxChars` map.
 *
 * - Expects a JSON object literal, e.g. `{"workbuddy-office-routing":300}`.
 * - Returns an empty map for empty/undefined input, malformed JSON, or a non-object
 *   (array / string / number / null) top-level value — the caller decides whether to warn.
 * - Skips any entry with an empty (post-trim) key, a value that is not a positive integer,
 *   or the dangerous `__proto__` / `constructor` / `prototype` keys (prototype-pollution guard).
 */
export declare function parseSkillDescMaxOverrides(raw: string | undefined | null): Map<string, number>;
/**
 * Global cap on total rendered skill entries. Non-user skills
 * (bundled/builtin/project/plugin/connector) are always rendered even if they alone
 * exceed this cap. User-level skills (source === 'user') are admitted in original
 * order only while (already rendered count) < this cap — the tail is omitted and
 * summarized in <skills_overview>. cbc-specific; CC has no such global cap.
 */
export declare const MAX_TOTAL_SKILLS = 200;
export type JsonSchemaDefinitionEntry = Record<string, any>;
export interface JsonObjectSchema<Properties extends Record<string, JsonSchemaDefinitionEntry>> {
    type: 'object';
    properties: Properties;
    required: (keyof Properties)[];
    additionalProperties: boolean;
}
export type UnknownContext = unknown;
export type ToolInputParameters = AgentsCoreToolInputParameters;
export type ToolParametersDefinition<TParameters extends ToolInputParameters = any> = TParameters | ((this: unknown, agent?: ProductAgent) => TParameters | Promise<TParameters>);
/**
 * 一次 REPL cell 内部工具调用的展示快照（只供 UI，不进模型上下文）。
 *
 * 每次调用在 TUI 只占一行；参数有独立预算，超限时只保留 `argumentsBytes`，
 * 避免内部调用把 session jsonl 撑大。
 */
export interface ReplToolCallDisplay {
    /** `<REPL callId>/<序号>`，稳定 key。 */
    id: string;
    name: string;
    /** 模型请求参数的 JSON 文本；超预算时省略，只留 `argumentsBytes`。 */
    arguments?: string;
    /** 参数被省略时的原始字节数。 */
    argumentsBytes?: number;
    status: 'ok' | 'error';
    durationMs?: number;
    /** 失败文案，已截断；成功调用不展示。 */
    error?: string;
}
/** 一次 REPL cell 的内部调用集合；`omitted` 是超出条数上限被丢弃的数量。 */
export interface ReplToolCallsDisplay {
    calls: ReplToolCallDisplay[];
    omitted: number;
}
export interface ToolResult {
    title?: string;
    content: string | unknown;
    error?: string;
    /** Hidden model-only reminders appended after the tool output. */
    context?: readonly string[];
    /** Plaintext range metadata used only by local presentation. */
    sensitiveProtection?: SensitiveProtectionMetadata;
    /** 工具结果已是当前 Agent run 的终局，不再交给模型重试 */
    terminal?: {
        reason: 'policy-denied';
        finalOutput: string;
    };
    /**
     * 工具结果的敏感内容处理策略（来自 DeferredToolInfo.sensitiveResultPolicy）。
     * 设为 'automatic-protection' 时，敏感准入层跳过弹窗直接走静默加密路径。
     * 由 DeferExecuteTool 在 MCP 工具执行后附加，经 FunctionCallResultProcessor
     * 透传到 providerData.toolResult，供 SensitiveHistoryAdmissionProcessor 消费。
     */
    sensitiveResultPolicy?: string;
    renderer?: {
        type?: 'markdown' | 'diff' | 'stream' | 'list' | 'text' | 'code' | 'todo' | 'plan' | 'enterplan' | 'media' | 'team-created' | 'team-member-spawned' | 'agent-spawned' | 'agent-output' | 'send-message' | 'workflow-started' | 'findings';
        context?: {
            language?: string;
            /**
             * Write 工具专用：文件的旧内容（新建文件为空字符串），供 TUI 层将
             * "code" 预览切换为 diff 视图。放在 context 而非 renderer.type='diff'，
             * 是因为 renderer.type 改动会影响 providerData.toolResult 的持久化路径。
             */
            originalContent?: string;
        };
        value?: string;
    };
    /**
     * Raw response data for hooks (PostToolUse) and telemetry.
     * Compatible with Claude Code hooks specification.
     */
    rawResponse?: unknown;
    /** Last visible Task/Todo snapshot produced inside one REPL cell, for the TUI. */
    replTaskPlanTodos?: TodoToolItem[];
    /** Inner tool calls of one REPL cell, for the TUI (bounded; not model-facing). */
    replToolCalls?: ReplToolCallsDisplay;
    /**
     * Internal, persisted source for projecting Task* results to a replacing
     * standard ACP v2 items plan.
     *
     * AcpUtils carries this value on an in-memory Symbol sidecar, so it never
     * appears on the ACP v1 wire or inside the emitted v2 plan. Do not use it
     * as presentation metadata; `rawResponse.todos` remains the v1/UI view.
     */
    acpV2PlanSnapshot?: {
        sourceId: string;
        revision: string;
        entries: Array<{
            content: string;
            priority: 'medium';
            status: 'pending' | 'in_progress' | 'completed';
        }>;
    };
    /**
     * Internal, persisted source for the standard ACP v2 Diff shown for a
     * completed file mutation. The v1 converter carries this value on a
     * process-local Symbol sidecar, so compatibility clients keep their
     * existing result-text wire while live v2 and replay share one artifact.
     */
    acpV2FileChange?: FileChangeArtifact;
    /** Final post-hook/post-rewrite input paired with `acpV2FileChange`. */
    acpV2FileChangeRawInput?: Record<string, unknown>;
    /**
     * MCP 工具调用结果上保留的元数据（MCP Apps 等扩展用）。
     *
     * `server.callTool()` 只返回 content 数组，CallToolResult 顶层的
     * `structuredContent` / `_meta` 在 mcp-server-override 里被剥离。这里通过
     * sideband sink（见 DeferExecuteTool.executeMcpTool 的 `__resultMetaSink`）
     * 把它们捞回来挂在结果上，供下游 ACP 透传给 Web UI 渲染 MCP Apps UI。
     *
     * - structuredContent：工具返回的结构化数据
     * - _meta：工具结果的扩展元数据（可能含 `ui` 等）
     * - uiResourceUri：该工具定义声明的 MCP Apps UI 资源 URI（来自 `_meta.ui.resourceUri`）
     * - uiServer：`ui://` 资源所在的已连接 MCP server。MCP 工具不填（宿主按调用的 server 解析）；
     *   非 MCP 工具（内置工具 / mod 在 `tool.call` 里改写的结果）要声明 MCP App 视图时必填，
     *   宿主据此只读该资源并挂到本次工具卡（见 mcp/mcp-app-view.ts），不替任何人执行工具。
     */
    mcpMeta?: {
        structuredContent?: Record<string, unknown>;
        _meta?: Record<string, unknown>;
        uiResourceUri?: string;
        uiServer?: string;
    };
    /**
     * 该次工具调用关联的 ACP v2 终端 id（见 acp/acp-terminal-types.ts）。
     *
     * 由后台执行类工具在返回结果时带上，acp-utils 据此在 `tool_call_update` 上附加
     * RFD 标准的 terminal content 锚点，让客户端能把独立推送的终端状态流关联到对应的
     * 工具卡片。
     *
     * 只能走 `tool_call_update` 这一跳：`tool_call` 事件在工具执行**之前**就已发出，
     * 那时 terminalId 尚未生成。
     */
    terminalId?: string;
    /**
     * 本次工具调用产出的文件，由脚本自己往 `$CODEBUDDY_ARTIFACTS` 指向的文件
     * 追加 JSON 行来声明（协议与解析见 `tools/produced-artifact.ts`）。
     *
     * 为什么需要它：`Bash` 上报 ACP `kind: 'execute'` 且不带 `locations`，所以
     * 「哪些文件是这次运行的交付物」在 ACP 层面无从得知——跑脚本产出的 pptx / pdf
     * 对下游完全不可见。让脚本显式声明，把这件事从模型行为（可能忘记调上传工具）
     * 变成代码行为（print 执行了就一定有）。
     *
     * 流式中间态不填。转后台的结果是唯一例外：命令还在跑，带的是转后台之前
     * 已经声明的那部分，之后新产出的文件要等 TaskOutput 链路支持解析。
     *
     * 该字段随整个 ToolResult 落到 `providerData.toolResult`，供下游消费；
     * 回灌模型的 `output.text` 只取 `content`，因此不会占用模型上下文。
     */
    producedArtifacts?: ProducedArtifact[];
    /**
     * 当该工具调用孵化了一个子 agent 会话时，记录该会话的 storeId 以及本次
     * 调用产生的那段历史的 **消息边界 id**（而非物理下标）。
     *
     * - 资源用途：resume 场景下 `StreamJsonView.renderHistory()` 借助这些信息
     *   把子 agent 的内部消息插入回放流（带 parent_tool_use_id），保持与
     *   live 流式输出一致的呈现。
     * - afterId：本次调用开始前 subAgent 历史里的最后一条 id（窗口从它之后开始）；
     *   undefined 表示本次调用从该子会话历史的最开头算起。
     * - lastId：本次调用结束时 subAgent 历史里的最后一条 id（窗口到它为止，含）；
     *   undefined 表示本次调用没有产生任何历史。
     *
     * 为什么用 id 而不是下标：historyStart/End 这类物理下标假设
     * “内存 history 长度 == jsonl 行号”，但该不变式会被 fork 注入父历史、
     * 跑中途上下文压缩/PTL 截断、jsonl 损坏行跳过等路径打破，导致 resume 切错。
     * message id 在 append-only jsonl 里稳定，读取时按 id 定位即可对齐，
     * 对上述所有路径免疫；定位失败时回放侧会 warn 并安全降级而非静默错乱。
     */
    subAgent?: {
        sessionId: string;
        afterId?: string;
        lastId?: string;
        descriptor?: SubagentLifecycleSnapshot;
    };
}
export interface TodoToolItem {
    id?: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm: string;
    dependencies?: string[];
    createdAt?: number;
    updatedAt?: number;
    /** Task owner (teammate name) for team progress display */
    owner?: string;
}
/**
 * A single structured code-review finding reported via ReportFindingsTool
 * (issue #74425). Kept terminal-render-agnostic so hosts other than the
 * agent-cli ink TUI (e.g. WorkBuddy) can consume the same structured data
 * and render it with their own UI.
 */
export interface FindingItem {
    /** File path the finding relates to (may include a line/range suffix). */
    file: string;
    /** Short one-line description of the issue found. */
    summary: string;
    /** Concrete scenario describing how/when the issue would actually fail or cause harm. */
    failureScenario: string;
    /** Optional category slug, e.g. 'correctness', 'test-coverage'. */
    category?: string;
}
/**
 * Return the todo snapshot that should be shown to users.
 * When every todo has reached completed, the visible todo list is cleared so
 * downstream clients do not keep showing stale finished work.
 */
export declare function getVisibleTodoItems<T extends {
    status?: string;
}>(todos: T[]): T[];
export declare namespace ToolResult {
    function is(result: any): result is ToolResult;
    function from(content: string | unknown): ToolResult;
}
export interface ToolCallDisplayProperty {
    type?: 'path' | 'url';
    name: string;
}
export interface ToolCallArgumentRenderer {
    displayProperties?: ToolCallDisplayProperty[];
    /**
     * 自定义工具调用头显示文本的格式化函数。
     * 设置后优先于默认的 displayProperties 渲染逻辑。
     * 返回 undefined 则回退到默认行为。
     */
    formatText?: (args: Record<string, any>) => string | undefined;
}
export type SensitiveToolEgressProjection = Pick<ToolEgressReviewRequest, 'source' | 'inspectionContent' | 'destinationKey'>;
export interface Tool<TParameters extends ToolInputParameters = any, Context = UnknownContext> {
    /**
     * The name of the tool. Must be unique within the agent.
     */
    name: string;
    /** Alternate permission names, shared by direct and deferred tool policy. */
    aliases?: string[];
    /** Host-created mod proxies dispatch once, inside their own execute method. */
    readonly dispatchesModToolCall?: boolean;
    /**
     * A transport names the tool its call runs (DeferExecuteTool): `tool.call`
     * is dispatched for that target, not the transport. `undefined` when the
     * input names none, or the target dispatches its own (a Mod's tool).
     */
    toolCallTarget?(input: unknown): ToolCallTarget | undefined;
    /**
     * Stability of the model-facing definition while the process is alive.
     * Agent tools default to stable; runtime-varying definitions opt into volatile.
     */
    readonly promptCacheStability?: PromptCacheStability;
    /**
     * The description of the tool. This is used to help the model understand when to use the tool.
     */
    description: string;
    /**
     * A JSON schema of the tool. To use a Zod schema.
     * Can be either:
     * - A static schema (ZodObject or JsonObjectSchema)
     * - A function that returns a Promise of the schema for dynamic generation
     */
    parameters: ToolParametersDefinition<TParameters>;
    /**
     * Whether the tool is strict  If true, the model must try to strictly follow the schema (might result in slower response times).
     */
    strict: boolean;
    /**
     * The function to invoke when the tool is called.
     */
    execute(input: ToolExecuteArgument<TParameters>, context?: RunContext<Context>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult> | ToolResult;
    /**
     * The function to invoke when an error occurs while running the tool.
     */
    errorFunction?: (context: RunContext, error: Error | unknown) => Promise<string> | string;
    /**
     * Whether this call may run alongside sibling calls of the same model turn
     * (Claude Code `isConcurrencySafe`). Consecutive safe calls share a parallel
     * window; any other call waits for every earlier call and blocks later ones.
     * Missing, throwing or non-`true` results run the call in model order.
     */
    isConcurrencySafe?(input: unknown): boolean | Promise<boolean>;
    /**
     * Whether the tool needs human approval before it can be called. If this is true, the run will result in an `interruption` that the
     * program has to resolve by approving or rejecting the tool call.
     */
    needsApproval?: boolean | ((runContext: RunContext<any>, input: any, callId?: string) => Promise<boolean>);
    argumentRenderer?: ToolCallArgumentRenderer;
    /**
     * Projects the post-hook, post-transform input into the fields that will
     * cross an execution boundary. Returning undefined classifies the call as
     * local/trusted for sensitive-egress purposes.
     */
    resolveSensitiveEgress?(input: TParameters, context: RunContext<Context>): SensitiveToolEgressProjection | undefined | Promise<SensitiveToolEgressProjection | undefined>;
    /**
     * Build the tool result fed back to the model after the user rejects this tool call.
     */
    resolveRejectedResult(rawItem: AgentInputItem): Promise<AgentInputItem[]>;
    /**
     * Extract raw response for hook usage (optional)
     * If not provided, ToolResult.content will be used as raw response
     * This ensures Claude Code hooks receive the correct tool_response format
     */
    extractRawResponse?(result: ToolResult): unknown;
    /**
     * Whether the tool is enabled. Can be a boolean or a function that returns a boolean or Promise<boolean>.
     * The function receives the run context and agent to allow dynamic enabling/disabling based on session state.
     */
    isEnabled?: boolean | ((args: {
        runContext: RunContext<Session>;
        agent: Agent;
    }) => boolean | Promise<boolean>);
    /**
     * Map a thrown non-ToolExecutionError to a structured tool error code.
     * Return undefined to let the ToolHookManager fall back to generic classification.
     */
    resolveThrownErrorCode?(error: unknown): string | undefined;
    /**
     * Deferred loading flag (aligned with Anthropic API).
     * - true: Tool is not loaded by default, needs to be activated via tool_search
     * - false/undefined: Tool is loaded immediately (default behavior)
     *
     * When defer_loading is true, the tool will not be included in the initial tool list sent to the model.
     * Model can discover and activate deferred tools using tool_search (semantic search).
     * Once activated, the tool becomes available for the rest of the session.
     */
    defer_loading?: boolean;
    /**
     * Optional method to determine if a deferred tool should be visible in ToolSearch results
     * and the deferred tools list in the system prompt.
     * Called dynamically at prompt generation time (not just at startup) to respond to
     * runtime configuration changes (e.g., enabling team features via /config).
     *
     * If not provided, the tool is always visible when defer_loading is true.
     * Return false to hide the tool from ToolSearch results and system prompt hints.
     */
    shouldShowInToolSearch?(): boolean;
}
export type { BackgroundTask, TerminalEvidence } from '../../vendor/cbc-core/node/index.js';
export interface ToolManager {
    /** Dynamic definitions share the registry used by get/execute. Builtins cannot be replaced. */
    register(tool: Tool): Promise<void>;
    unregister(name: string): Promise<void>;
    listDynamicToolNames(): string[];
    /** Agent tool snapshots must be rebuilt when this version changes. */
    readonly registryVersion: number;
    get<TParameters extends ToolInputParameters = any, Context = UnknownContext>(name: string, agentConfig?: ProductAgent, cachedProductConfig?: {
        agents?: any[];
        models?: any[];
        skills?: any[];
        commands?: any[];
        tools?: any[];
    }): Promise<Tool<TParameters, Context> | undefined>;
    /**
     * Index a tool for deferred loading search capability.
     * Called when a tool is configured as defer_loading in product config.
     */
    indexDeferredTool(tool: Tool): Promise<void>;
    /**
     * Snapshot of the registered builtin tools (name → Tool).
     *
     * Needed by the REPL catalog source: non-deferred builtins are absent from the
     * ToolSearchService index (only `defer_loading` tools get indexed there), so they
     * must be read straight from the registry to appear in the skeleton catalog.
     *
     * Returns a copy — callers must not mutate the manager's registry.
     */
    listRegisteredTools(): Map<string, Tool>;
    /**
     * 幂等懒索引：当会话级 overlay 强制让某个内置工具变成 defer 时，第一次访问
     * 就将它注册到 ToolSearchService。已索引时返回 false，索引成功返回 true。
     * 仅作用于 toolMap 中的内置工具；MCP 工具不走此路径。
     */
    ensureBuiltinDeferIndexed(toolName: string): Promise<boolean>;
    /**
     * 在工具执行前创建文件备份（file-history 快照），返回被跟踪的文件路径。
     *
     * 直连路径由 {@link executeToolWithHooks} 内部自动调用；REPL/Code Mode 沙箱
     * 执行路径（DeferExecuteTool.routeToolCall → executeBuiltinTool）绕过该 hook
     * 包装，需在真正执行工具前显式调用本方法，否则沙箱内的 Edit/Write 不产生
     * FileHistorySnapshotItem，rewind 无快照可恢复（#130664）。
     *
     * 依赖 FileTrackService.trackFile 幂等（文件已在当前 checkpoint 即跳过），两条
     * 路径都触达时也只落一次快照。
     */
    trackFileForToolCall(toolName: string, toolInput: unknown, session: Session, details?: {
        toolCall: FunctionCallItem;
    }): Promise<string | undefined>;
    addBackgroundTask(task: BackgroundTask): void;
    removeBackgroundTask(id: string): void;
    getBackgroundTasks(): BackgroundTask[];
    getBackgroundTask(id: string): BackgroundTask | undefined;
    /**
     * 停止一个后台任务。
     *
     * @param options.suppressNotification 抑制这次收口产生的 `<task-notification>`。
     *   给模型主动调用的 TaskStop / KillShell 用：它们的 ToolResult 已经带上了结果，
     *   再收一条通知属冗余打扰。停止失败时这个抑制会被自动撤销，避免任务后来自然
     *   结束时的通知被永久吞掉。UI 触发的停止不传它，照常通知。
     */
    killBackgroundTask(id: string, options?: {
        suppressNotification?: boolean;
    }): Promise<boolean>;
    /**
     * 杀掉归属该 session 的后台任务（shell / workflow 等）。
     *
     * 正式 team member（`isTeamMember=true`）被排除在外——它们只是为了事件流而
     * 挂在父 session 名下，生命周期不归该 session 管。详见
     * {@link BackgroundTask.isTeamMember}。
     */
    killBackgroundTasksBySessionId(sessionId: string): Promise<void>;
    /** Clear sensitive mediation state for the released session. */
    clearSensitiveSession?(sessionId: string): void;
    /**
     * Invalidate cached tool description for a specific tool name.
     * Needed when the data feeding the description (e.g. product.skills
     * contributed by plugins) changes after the first render.
     */
    invalidateCachedToolDescription(toolName: string): void;
    /**
     * Invalidate every tool description cache that depends on plugin-contributed
     * data (skills / commands / agent tools). Used by plugin state change paths
     * (install / uninstall / enable / disable / switch / refreshProductAndTools /
     * plugin agent override) so the next LLM request renders up-to-date descriptions.
     */
    invalidatePluginDependentToolCaches(): void;
    /**
     * session-agent-view 的清单渲染入口：与进程级构建同一渲染管线，但完全绕开
     * 进程描述缓存（不读不写），会话档输入按值传入。命中模式级覆盖表
     * （REPL/minimal/multitask）时返回 undefined——覆盖描述与会话无关，视图应
     * 保留基座工具对象。
     */
    renderSessionToolDescription(name: string, agentConfig: ProductAgent | undefined, inputs: SessionViewRenderInputs, cachedProductConfig?: {
        agents?: any[];
        models?: any[];
        skills?: any[];
        commands?: any[];
        tools?: any[];
    }): Promise<string | undefined>;
    /**
     * 指定会话的 `--tools` 白名单 / Defer-overlay 稳定指纹（session-agent-view
     * 的失效判据之一）。无会话维度时返回空串。
     */
    sessionToolsDescriptionFingerprint(session: Session): string;
    /**
     * 出站 A2A 目录对 A2AGetAgentCard 描述的稳定指纹（session-agent-view 的
     * 在场判定+按值失效判据）：只编码模板真正消费的字段（agent name +
     * description，与渲染分支同一归一化）。带 session 时按会话目录解析
     * （QueryOptions.remoteAgentsUrl 的会话源分区；无席位=进程目录），纯查表
     * 不触发 discovery。registry 未绑定或目录为空返回空串——无 A2A 的
     * 进程/会话恒空，不触发视图构建。
     */
    a2aAgentsDescriptionFingerprint(session?: Session): string;
}
/** session-agent-view 渲染的按值会话输入（ALS 无关，构建点可在任意 scope）。 */
export interface SessionViewRenderInputs {
    session: Session;
    sessionSkills?: ProductSkill[];
    sessionCommands?: ProductCommand[];
    /** 会话档 agent（已去掉插件 settings.agent 根），并入 Agent 工具的子代理目录。 */
    sessionAgents?: ProductAgent[];
}
export interface ToolPermissionStrategy {
    mode: PermissionMode;
    needApproval(tool: BaseTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, checkArgs: ToolArg[], callId?: string): Promise<boolean>;
}
/**
 * 后台会话的写隔离守卫。
 *
 * 实现在 agent-view 层（它才知道自己是不是 job worker）；符号放在
 * tools 层是为了让 ToolManager 不反向依赖 agent-view。普通交互会话里
 * prepareWrite 永远返回 undefined，零开销。
 */
export declare const BackgroundWriteIsolationGuard: unique symbol;
export interface BackgroundWriteIsolationGuard {
    /**
     * 在文件编辑类工具落盘前调用：首次写时把后台会话移入隔离
     * worktree；已隔离时把指向原检出的绝对路径重定向到 worktree 内。
     *
     * @returns 需要改写的路径参数（字段名 + 新值）；无需改写返回 undefined
     */
    prepareWrite(toolName: string, toolInput: Record<string, any>): Promise<{
        field: string;
        value: string;
    } | undefined>;
}
/**
 * Tool Hook Manager interface - handles tool-specific hooks (PreToolUse/PostToolUse)
 * Compatible with Claude Code hooks specification
 */
export declare const ToolHookManager: unique symbol;
export interface ToolHookManager {
    /**
     * Execute PreToolUse hooks before a tool is executed
     *
     * @param toolName - Name of the tool to be executed
     * @param toolInput - Input parameters for the tool
     * @param sessionId - Current session ID
     * @param transcriptPath - Path to conversation transcript
     * @param cwd - Current working directory
     * @returns Result indicating whether to proceed and any modified input
     */
    executePreToolUseHooks(toolName: string, toolInput: Record<string, any>, session: Session, transcriptPath: string, cwd?: string, callId?: string): Promise<{
        allowed: boolean;
        modifiedInput?: Record<string, any>;
        message?: string;
        permissionDecision?: 'allow' | 'deny' | 'ask';
        permissionDecisionReason?: string;
        runtimeSecurity?: Record<string, unknown>;
        /** hook 声明的审批元数据（`codebuddy.ai/approval`，issue #121874）。 */
        approvalMeta?: Record<string, string>;
        preventContinuation?: boolean;
    }>;
    /**
     * Execute PostToolUse hooks after a tool completes successfully
     *
     * @param toolName - Name of the executed tool
     * @param toolInput - Input parameters that were passed to the tool
     * @param toolResponse - Raw response from the tool (not ToolResult wrapper)
     * @param sessionId - Current session ID
     * @param transcriptPath - Path to conversation transcript
     * @param cwd - Current working directory
     * @returns Result with optional message and additional context
     */
    executePostToolUseHooks(toolName: string, toolInput: Record<string, any>, toolResponse: unknown, session: Session, transcriptPath: string, cwd?: string, callId?: string, internalContext?: InternalHookContext): Promise<{
        message?: string;
        additionalContext?: string;
        updatedToolOutput?: unknown;
    }>;
    /**
     * Execute PostToolUseFailure hooks after a tool throws or is interrupted.
     * Observe-only (additionalContext allowed, no block semantics).
     *
     * @param toolName - Name of the failed tool
     * @param toolInput - Input passed to the tool
     * @param error - The error that was thrown
     * @param session - Current session
     * @param transcriptPath - Path to conversation transcript
     * @param cwd - Current working directory
     * @param callId - Tool call ID (mapped to tool_use_id)
     * @param isInterrupt - Whether the failure was caused by a user interrupt
     */
    executePostToolUseFailureHooks(toolName: string, toolInput: Record<string, any>, error: unknown, session: Session, transcriptPath: string, cwd?: string, callId?: string, isInterrupt?: boolean): Promise<{
        message?: string;
        additionalContext?: string;
        updatedToolOutput?: unknown;
    }>;
    /**
     * Register a tool-level thrown error classifier.
     * ToolManager calls this during initialization so each tool owns its own
     * error-code mapping instead of hard-coding tool names in ToolHookManager.
     */
    registerToolErrorResolver(toolName: string, resolver: (error: unknown) => string | undefined): void;
}
export interface ToolArgumentRewriteService {
    process(input: any): ToolExecuteArgument<any>;
}
export interface ReadFileStateService {
    /** 记录一次文件读取（用于后续 mtime 乐观并发校验）。 */
    readFile(filePath: string, fileStats: {
        mtime: Date;
    }): void;
    refreshFile(filePath: string): Promise<void>;
    hasBeenRead(filePath: string): boolean;
    hasBeenModifiedSinceLastRead(filePath: string): Promise<boolean>;
}
export { ToolPermissionType, ToolArgType } from '../../vendor/cbc-shared/node/index.js';
export type { ToolArg } from '../../vendor/cbc-shared/node/index.js';
export { ToolNames } from '../../vendor/cbc-shared/node/index.js';
/**
 * 动态描述输入表：每行把一个工具描述绑到驱动它的**动态输入**——动态的是
 * 输入本体（会话档技能/命令/agent、`--tools` 白名单指纹、A2A 目录指纹），不是
 * 工具，故名不带 tool 中心词。「动态」的分界线：
 * 输入在进程物化周期（rebuild/refresh 重渲染一切描述）**之外**变化——会话档
 * 数据（技能/命令/agent，引用即失效）或运行期目录的指纹（在场判定+按值失效）；
 * 反例如进程档 agents 目录只随 rebuild 变，物化面天然新鲜，只有会话档 agent 入表。
 * 表由 session-agent-view 消费：输入在场时视图把该描述换成视图内渲染字节，
 * 进程物化面与描述缓存只承载无这些输入时的基线。声明与渲染同源放在工具
 * 协议层（渲染管线把清单交给模板的正是 ToolManager）——加行即自动纳入。
 * A2AGetAgentCard 的目录本体是进程级注册表（#99451，DI 单例），非会话数据
 * ——入表用目录指纹，使视图对目录变更自足新鲜，不单赖「目录变更→全 agent
 * refresh→基座换引用」的反应链（该链保留，负责无视图会话的基座诚实）；
 * 会话档 A2A（#108461 家族）落地时本行输入换会话维度即可。
 */
export declare const DYNAMIC_DESCRIPTION_INPUTS: ReadonlyArray<{
    tool: string;
    input: 'sessionSkills' | 'sessionCommands' | 'sessionAgents' | 'toolsFingerprint' | 'a2aAgentsFingerprint';
}>;
/**
 * #82046：解析一次工具调用的**有效目标工具名**，穿透 DeferExecuteTool 包装。
 *
 * 模型可以直接调 `ExitPlanMode`，也可以经 `DeferExecuteTool({ toolName: 'ExitPlanMode',
 * params })` 派发（ToolSearch/deferred 场景，WorkBuddy 产品实测走这条）。两种形态下
 * 审批项 / rawItem 的顶层 `name` 不同：直接调是 `ExitPlanMode`，defer 派发是
 * `DeferExecuteTool`，真正的目标藏在 `arguments.toolName` 里。
 *
 * 任何"按工具名分流"的逻辑（是否加 ExitPlanMode 的第 4 个审批选项、是否给审批弹窗
 * 注入 plan、是否把拒绝当成「继续规划」而非中断、拒绝时该调哪个工具的
 * `resolveRejectedResult`）都必须用**有效目标名**判定，否则 defer 派发的调用会被
 * 当成普通 `DeferExecuteTool` 处理 —— 这正是 #82046 在桌面端复发的根因。
 *
 * @param rawItem SDK 的 function_call item（含 `name` 与可能为 JSON 字符串的 `arguments`）
 * @returns 有效目标工具名；非 defer 包装时即顶层 `name`；无法解析时回退顶层 `name`
 */
export { resolveEffectiveToolName } from '../../vendor/cbc-shared/node/index.js';
export declare enum ToolIdent {
    EDIT = "Edit",
    MULTIEDIT = "MultiEdit",
    READ = "Read",
    LIST = "List",
    BASH = "Bash",
    WRITE = "Write",
    GLOB = "Search",
    GREP = "Search",
    TODO = "Todo",
    MEMORY = "Memory",
    FETCH = "Fetch",
    AGENT = "Agent",
    SEARCH = "Search",
    ENTER_PLAN_MODE = "Entered plan mode",
    EXIT_PLAN_MODE = "Plan ready",
    TEAM = "Team",
    MESSAGE = "Message",
    POWERSHELL = "PowerShell"
}
export declare const DEFAULT_DISPLAY_ROWS = 3;
export declare const DEFAULT_EXCLUDE_DIRS: string[];
export declare const LIST_TOOL_BLOCK_SIZE = 500;
export { TOOL_NO_CONTENT } from '../../vendor/cbc-shared/node/index.js';
export declare const TOOL_EXTEND_TEXT = "(ctrl+o to expand)";
export declare const TOOL_BACKGROUND_TEXT = "(ctrl+b to background execution)";
export declare const TOOL_SEEALL_TEXT = "(ctrl+o to see all)";
export { TOOL_REJECT_RESULT_CONTENT } from '../../vendor/cbc-shared/node/index.js';
export declare const TOOL_REJECT_RESULT_DISPLAY: () => string;
export declare const TOOL_REJECT_CONTENT: () => string;
export { USER_DECLINED_TO_ANSWER_QUESTIONS } from '../../vendor/cbc-shared/node/index.js';
/**
 * Guidance appended to permission-denied tool results.
 * Instructs the model to try reasonable alternatives first, and if the denied
 * capability is essential, STOP and explain to the user what permission is needed.
 */
export { PERMISSION_DENIED_GUIDANCE } from '../../vendor/cbc-shared/node/index.js';
/**
 * Build a permission-denied message for a tool.
 * Structure: tool name + denial reason + IMPORTANT guidance.
 */
export declare function buildPermissionDeniedMessage(toolName: string, reason: string): string;
export declare class ToolError extends Error {
    isToolError(): boolean;
}
export declare class PermissionDeniedError extends ToolError {
    readonly toolName: string;
    readonly rule?: string | undefined;
    constructor(toolName: string, message: string, rule?: string | undefined);
}
/**
 * 携带结构化错误码的工具执行异常。
 *
 * 抛出后由 galileo-tool-error-report-hook (Path 2 / thrown) 提取 toolErrorCode，
 * 上报到 agent.tool.error_detail 和 chat_tool_action 事件。
 *
 * toolErrorCode 为纯数字字符串（如 '1001'），值来自 ToolErrorCode 枚举。
 */
export declare class ToolExecutionError extends Error {
    readonly toolErrorCode: string;
    constructor(message: string, toolErrorCode: string);
}
/**
 * 判定是否为 ToolExecutionError。
 *
 * 不用裸 `instanceof` —— Cell.js / rspack 打包后同一个类可能跨 bundle 产生多份
 * 构造函数，导致 `instanceof` 在跨模块抛接时失效。改为兼容 name + duck-typing。
 */
export declare function isToolExecutionError(error: unknown): error is ToolExecutionError;
export interface ToolAlwaysApprovalStore {
    has(sessionId: string, signature: string): boolean;
    add(sessionId: string, signature: string): void;
    delete(sessionId: string): void;
}
export type { ApprovalOptions } from '../../vendor/cbc-shared/node/index.js';
/** Permission item providerData 中的 Reviewer 风险元数据键。 */
export { TOOL_RISK_APPROVAL_PROVIDER_KEY } from '@genie/agent-client-protocol';
export interface ToolAlwaysApprovalService {
    /**
     * Approve a tool and optionally add to always-approve list
     * @param session The current session
     * @param item The tool approval item
     * @param scope The scope for persistence ('session' or 'localSettings')
     */
    approve(session: Session, item: RunToolApprovalItem, scope?: ApprovalScope, ruleToolName?: string): Promise<void>;
    isApproved(session: Session, item: RunToolApprovalItem): boolean;
    getSessionApprovalRules(session: Session, item: RunToolApprovalItem): RuleValue[];
    /**
     * Record a task-scoped, single-call confirmation (issue #139526): command-gate /
     * skill-script memories stop re-asking within the current user request; tools
     * without such memory no-op.
     */
    rememberTaskScopedApproval(session: Session, item: RunToolApprovalItem): void;
    /**
     * Match a Bash command against host-declared command gates (issue #139526, env
     * `CODEBUDDY_COMMAND_APPROVAL_PATTERNS`). Returns the matched declaration or
     * undefined; non-Bash tools never match.
     */
    matchCommandGate(toolName: string, input: ToolExecuteArgument<any>): {
        pattern: string;
        approvalKind: string;
    } | undefined;
    /**
     * Whether the command gate is already approved (issue #139526): in-memory signature
     * (`Bash:cmd:<pattern>`, session scope) or the approval state file — `commands`
     * (session-wide "always allow") / `turnCommands` (current user request, "confirm").
     */
    isCommandGateApproved(session: Session, pattern: string): boolean;
    clear(sessionId: string): void;
}
export { PersistableSettingSources } from '../../vendor/cbc-shared/node/index.js';
export type { RuleBehavior, RuleValue, SettingSource, ApprovalScope, Rule, DecisionReason, RuleSuggestion, ToolPermissionResult, PermissionUpdate, PermissionSetModeUpdate, PermissionAddRulesUpdate, PermissionReplaceRulesUpdate, PermissionRemoveRulesUpdate, PermissionAddDirectoriesUpdate, PermissionRemoveDirectoriesUpdate, ToolPermissionContext, } from '../../vendor/cbc-shared/node/index.js';
export interface ToolPermissionService {
    /**
     * Check if a tool needs approval before execution
     * Returns a PermissionResult with detailed decision information
     *
     * @param tool The tool to check
     * @param runContext The current run context
     * @param input The tool input arguments
     * @param callId Optional call identifier
     * @param resolveArgsCallback Optional callback to resolve permission args for the tool
     * @returns Promise<ToolPermissionResult> with behavior and decision details
     */
    checkPermission(tool: BaseTool | McpTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, callId?: string, resolveArgsCallback?: (runContext: RunContext, input: ToolExecuteArgument<any>, callId?: string) => ToolArg[]): Promise<ToolPermissionResult>;
    /**
     * The engine's declarative verdict on a call, for the official Mods `$.tool.check` query:
     * the rules, the mode and the tool's own check, before the mode settles an ask.
     *
     * Unlike {@link checkPermission}, an ask stays an ask (no dontAsk deny, no auto-mode
     * classifier, no headless deny), and nothing runs: no hook, no tool, no dialog.
     */
    checkDeclaredPermission(tool: BaseTool | McpTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, resolveArgsCallback?: (runContext: RunContext, input: ToolExecuteArgument<any>, callId?: string) => ToolArg[]): Promise<ToolPermissionResult>;
    /** Re-evaluate only the host permission baseline for already-transformed arguments. */
    recomputeFinalPermission(tool: BaseTool | McpTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, callId?: string, resolveArgsCallback?: (runContext: RunContext, input: ToolExecuteArgument<any>, callId?: string) => ToolArg[], hookDecision?: 'ask'): Promise<ToolPermissionResult>;
    /**
     * Rule-only inherited-restriction check for final execution boundaries
     * (DeferExecuteTool / REPL). Returns only rule decisions — no strategy, no
     * mode finalization, no classifier — so callers that already handled
     * interactive approval can still fail closed on a deny.
     */
    checkInheritedRestrictions(tool: BaseTool | McpTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, callId?: string, resolveArgsCallback?: (runContext: RunContext, input: ToolExecuteArgument<any>, callId?: string) => ToolArg[]): ToolPermissionResult | undefined;
    /**
     * Check if a tool needs approval before execution
     * This is the simplified API that returns boolean for compatibility with openai/agents-core
     *
     * @param tool The tool to check (can be MCP prefixed like mcp__server__tool)
     * @param runContext The current run context
     * @param input The tool input arguments
     * @param callId Optional call identifier
     * @param resolveArgsCallback Optional callback to resolve permission args for the tool
     * @returns Promise<boolean> true if approval is needed, false otherwise
     */
    needsApproval(tool: BaseTool | McpTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, callId?: string, resolveArgsCallback?: (runContext: RunContext, input: ToolExecuteArgument<any>, callId?: string) => ToolArg[]): Promise<boolean>;
    /**
     * Bash command gate (issue #139526), called by `BashTool.needsApproval` on both the
     * sandbox and the legacy path before its own decision.
     *
     * Returns undefined when the command does not hit a host-declared gate (env) or the
     * gate is already approved for this session / user request; the caller then runs
     * its original flow unchanged. On a hit, the caller's original checks (`baseline`)
     * run first: a denial stands and false is returned. Otherwise the high-credit
     * confirmation is stacked on their cached result (an `ask` decision plus approval
     * metadata for the ACP layer) and true is returned.
     */
    applyCommandGate(tool: BaseTool | McpTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, callId: string | undefined, baseline: CommandGateBaseline, resolveArgsCallback?: (runContext: RunContext, input: ToolExecuteArgument<any>, callId?: string) => ToolArg[]): Promise<boolean | undefined>;
    /**
     * Apply a permission update to the session context
     * Used for runtime rule modifications (e.g., user approves a tool)
     * For persistable sources (userSettings, projectSettings, localSettings),
     * also syncs to settings files
     */
    applyUpdate(session: Session, update: PermissionUpdate): Promise<void>;
    /**
     * Initialize the permission context for a session
     * Should be called when session starts to load settings
     */
    initializeContext(session: Session): Promise<void>;
}
/** 文生图模型的 tag 标识 */
export declare const TEXT_TO_IMAGE_MODEL_TAG = "text-to-image";
/** 图生图模型的 tag 标识 */
export declare const IMAGE_TO_IMAGE_MODEL_TAG = "image-to-image";
/**
 * 基础图片参数 Schema - 文生图和图生图共享
 */
export declare const BaseImageParameters: z.ZodObject<{
    prompt: z.ZodString;
    size: z.ZodOptional<z.ZodString>;
    quality: z.ZodOptional<z.ZodString>;
    style: z.ZodOptional<z.ZodString>;
    background: z.ZodOptional<z.ZodString>;
    footnote: z.ZodOptional<z.ZodString>;
    revise: z.ZodOptional<z.ZodBoolean>;
    output_dir: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    prompt: string;
    size?: string | undefined;
    background?: string | undefined;
    quality?: string | undefined;
    style?: string | undefined;
    footnote?: string | undefined;
    revise?: boolean | undefined;
    output_dir?: string | undefined;
}, {
    prompt: string;
    size?: string | undefined;
    background?: string | undefined;
    quality?: string | undefined;
    style?: string | undefined;
    footnote?: string | undefined;
    revise?: boolean | undefined;
    output_dir?: string | undefined;
}>;
/**
 * 图生图扩展参数 Schema
 */
export declare const ImageEditExtendParameters: z.ZodObject<{
    image: z.ZodString;
    input_fidelity: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    image: string;
    input_fidelity?: string | undefined;
}, {
    image: string;
    input_fidelity?: string | undefined;
}>;
/**
 * 文生图 API 请求参数
 */
export interface GenerateImageParams {
    prompt: string;
    size?: string;
    n?: number;
    quality?: string;
    style?: string;
    background?: string;
    footnote?: string;
    revise?: boolean;
}
/**
 * 图生图 API 请求参数
 */
export interface EditImageParams extends GenerateImageParams {
    /** Base64 编码的图片数据数组，格式: ["image/jpeg;base64,..."] */
    image: string[];
    /** 风格匹配程度 */
    input_fidelity?: string;
}
/**
 * Image Gen API 响应包装
 */
export interface ImageGenApiResponse {
    code: number;
    msg: string;
    request_id: string;
    data: ImageGenResult;
}
export interface GenerationCreditResult {
    /** 后端返回的实际积分消耗；缺失表示后端未返回实际消耗。 */
    credit?: number;
}
export interface ImageGenerationResult extends GenerationCreditResult {
    localPaths: string[];
}
export interface VideoGenerationResult extends GenerationCreditResult {
    localPaths: string[];
    /** 端上为适配模型能力做出的调整说明（如分辨率回落），供模型与用户知情 */
    warnings?: string[];
}
/**
 * 图片生成结果
 */
export interface ImageGenResult {
    created?: number;
    data?: ImageGenData[];
    size?: string;
    quality?: string;
    output_format?: string;
    background?: string;
    usage?: ImageGenUsage;
}
/**
 * 单张图片数据
 */
export interface ImageGenData {
    b64_json?: string;
    url?: string;
    revised_prompt?: string;
}
/**
 * Token 使用信息
 */
export interface ImageGenUsage {
    input_tokens?: number;
    input_text_tokens?: number;
    input_image_tokens?: number;
    output_tokens?: number;
    output_text_tokens?: number;
    output_image_tokens?: number;
    total_tokens?: number;
    output_image_counts?: number;
    output_image_coefficient?: number;
    credit?: number;
}
export declare const ImageService: unique symbol;
/**
 * 图片服务接口
 * 封装文生图和图生图的共享逻辑
 */
export interface ImageService {
    /** 初始化输出目录 */
    initializeOutputDir(customOutputDir?: string): Promise<void>;
    /** 文生图 API 调用 */
    generateImage(params: GenerateImageParams, context: RunContext<Session>): Promise<ImageGenerationResult>;
    /** 图生图 API 调用 */
    editImage(params: EditImageParams, context: RunContext<Session>): Promise<ImageGenerationResult>;
    /** 处理图片输入，转换为 base64 格式 */
    processImageInput(imageInput: string, signal?: AbortSignal, session?: Session): Promise<string>;
    /** 保存图片到本地 */
    saveImage(imageData: ImageGenData, prompt: string, index: number, signal?: AbortSignal): Promise<string>;
    /** 从错误中提取错误信息 */
    extractErrorMessage(error: unknown): string;
    /** 获取指定 tag 的模型列表 */
    getModelsByTag(product: ProductConfiguration, tag: string): LanguageModel[];
    /** 解析模型，优先级：session options > 环境变量 > 合并设置 > 配置中第一个对应 tag 的模型 > fallback */
    resolveModel(session: Session | undefined, tag: string): Promise<string>;
}
export declare const VideoService: unique symbol;
/** 文生视频模型的 tag 标识 */
export declare const TEXT_TO_VIDEO_MODEL_TAG = "text-to-video";
/** 图生视频模型的 tag 标识 */
export declare const IMAGE_TO_VIDEO_MODEL_TAG = "image-to-video";
/** 文生视频/素材参考视频请求参数 */
export interface VideoGenParams {
    prompt: string;
    image?: string;
    last_image?: string;
    reference_images?: string[];
    reference_videos?: string[];
    reference_audios?: string[];
    resolution?: string;
    seconds?: number;
    aspect_ratio?: string;
    enable_audio?: boolean;
}
/** 视频生成 API 响应（创建任务） */
export interface VideoGenApiResponse {
    code: number;
    msg: string;
    requestId: string;
    data: {
        id: string;
        status: string;
        created_at: number;
    };
}
/** 视频任务查询响应 */
export interface VideoTaskResponse {
    code: number;
    msg: string;
    requestId: string;
    data: {
        id: string;
        status: 'queued' | 'in_progress' | 'completed' | 'failed';
        created_at: number;
        completed_at?: number;
        data?: Array<{
            url: string;
            resolution?: string;
        }>;
        size?: string;
        usage?: VideoGenUsage;
    };
}
export interface VideoGenUsage {
    output_video_duration?: number;
    output_video_coefficient?: number;
    credit?: number;
}
/**
 * 视频服务接口
 */
export interface VideoGenerationPlan {
    readonly model: string;
    readonly capability?: ModelVideoGeneration;
}
export interface VideoService {
    /** Validate before material I/O and retain the selected model/configuration for this call. */
    prepareGeneration(params: VideoGenParams, session: Session): Promise<VideoGenerationPlan>;
    /** 初始化输出目录 */
    initializeOutputDir(customOutputDir?: string): Promise<void>;
    /** 文生视频/图生视频：提交任务 + 轮询 + 下载 */
    generateVideo(params: VideoGenParams, context: RunContext<Session>, plan?: VideoGenerationPlan): Promise<VideoGenerationResult>;
    /** 解析视频模型：session > env > settings > defaultVideoModel > 完整能力配置的 tag 模型 */
    resolveModel(session: Session | undefined, tag: string): Promise<string>;
}
export declare const AudioTranscribeService: unique symbol;
/**
 * tool 层已判定好的音频来源。
 * 本地文件需要先上传 COS 才有公网可下载地址；调用方给出的 URL 直接提交。
 */
export type AudioTranscribeSource = {
    readonly filePath: string;
} | {
    readonly audioUrl: string;
};
/** 提交给上游的音频来源（本服务始终用 audio_url，从不用 audio_data）。 */
export interface AudioSource {
    audio_url: string;
}
/** 后端预签名返回项（`support:getPresignedUrls` 契约）。 */
export interface AsrPresignItem {
    object_key: string;
    upload_url: string;
    download_url: string;
}
/** 预签名接口响应信封。 */
export interface AsrPresignApiResponse {
    code: number;
    msg?: string;
    message?: string;
    requestId?: string;
    data?: {
        expire?: number;
        items?: AsrPresignItem[];
    };
}
/** 提交任务响应信封（/v2/async/tasks/create）。 */
export interface AsrCreateApiResponse {
    code: number;
    msg: string;
    requestId: string;
    data?: {
        task_id?: string;
        scene?: string;
        status?: string;
        created_at?: string;
    };
}
/** 查询任务响应信封（/v2/async/tasks/query）。 */
export interface AsrQueryApiResponse {
    code: number;
    msg: string;
    requestId: string;
    data?: {
        task_id?: string;
        scene?: string;
        status?: 'queued' | 'in_progress' | 'completed' | 'failed';
        created_at?: string;
        completed_at?: string;
        usage?: {
            credit?: number;
            coefficient?: number;
            meters?: {
                audio_second?: number;
            };
        };
        attributes?: {
            engine?: string;
            vendor_status?: string;
        };
        error?: {
            code?: string;
            message?: string;
        };
        audio_transcription?: {
            text?: string;
        };
    };
}
/** 录音文件识别结果。 */
export interface AudioTranscribeResult {
    /** 完整转写文本（上游 Result 原样透传） */
    text: string;
    /** 任务 ID */
    taskId: string;
    /** 实际音频时长（秒），计费依据 */
    audioSecond?: number;
    /** 最终积分消耗 */
    credit?: number;
}
/**
 * 录音文件识别服务接口。
 * 本地文件先经后端预签名上传 COS 换取 download_url；调用方给的 URL 直接用。
 * 两种来源都以 audio_url 提交异步转写并轮询。
 *
 * 识别参数（`channel_num` / `speaker_diarization`）由 service 固定注入，
 * 按 #128310 不向 Agent 暴露开关。
 */
export interface AudioTranscribeService {
    /**
     * 转写音频：解析来源（本地文件则预签名上传）→ 提交任务 → 轮询直至终态。
     */
    transcribe(source: AudioTranscribeSource, context: RunContext<Session>): Promise<AudioTranscribeResult>;
}
