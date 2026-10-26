import { AgentManager, Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { type FunctionCallItem, RunContext, ToolExecuteArgument, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { z } from 'zod';
import { AcpBroadcastService } from '../acp/acp-protocol';
import { AgentScopedMcpManager, McpConfigManager, McpManager } from '../mcp/mcp-protocol';
import { BaseTool } from './base-tool';
import { DeferToolConfigService } from './defer-tool-config-protocol';
import type { ToolCallTarget } from './tool-call-boundary';
import { Tool, ToolCallArgumentRenderer, ToolManager, ToolResult } from './tool-protocol';
import { type ToolRiskReviewService as ToolRiskReviewServiceInterface } from './tool-risk-review';
import { ToolSearchService } from './tool-search-protocol';
import { AgentToolDeferOverlayCache } from './tool-spec';
/**
 * Parameters for the DeferExecuteTool
 */
declare const DeferExecuteParameters: z.ZodObject<{
    toolName: z.ZodString;
    params: z.ZodRecord<z.ZodString, z.ZodAny>;
}, "strip", z.ZodTypeAny, {
    toolName: string;
    params: Record<string, any>;
}, {
    toolName: string;
    params: Record<string, any>;
}>;
/**
 * Proxy tool for executing deferred-loading tools without injecting their
 * definitions into the LLM tools list.
 *
 * Supports built-in deferred tools (e.g., ImageGen, LSP), canonical MCP tools
 * (`mcp__server__tool`), and bare-name MCP tools from transparent proxy.
 *
 * Tool Enable & SDK Filtering:
 * Built-in deferred tools use the AgentManager wrapped isEnabled chain, including
 * defer activation bypass, original tool availability, SDK allow/deny options,
 * delegate-mode restrictions, and other visibility gates.
 *
 * Deferred MCP tools are not listed in agent.tools. They bypass the agent tool-name
 * filter here, but are still subject to the subagent MCP whitelist
 * (McpSubagentToolManager, when the agent registered one) and to
 * ToolPermissionService deny/approval checks before execution.
 *
 * Flow:
 * 1. Model calls ToolSearch → gets tool name, description, and full parameter schema
 * 2. Model calls DeferExecuteTool({ toolName, params }) → checks isEnabled + SDK filters
 * 3. If tool passes all checks, validates params against schema and delegates to the real tool
 *
 * This keeps the LLM context prefix (system prompt + tools list) stable,
 * maximizing KV cache hit rate on providers that support prefix caching.
 */
export declare class DeferExecuteTool extends BaseTool implements Tool {
    protected readonly toolManager: ToolManager;
    protected readonly toolSearchService: ToolSearchService;
    protected readonly deferToolConfigService: DeferToolConfigService;
    protected readonly agentToolDeferOverlayCache: AgentToolDeferOverlayCache;
    protected readonly logger: Logger;
    name: ToolNames;
    isEnabled: () => Promise<boolean>;
    parameters: z.ZodObject<{
        toolName: z.ZodString;
        params: z.ZodRecord<z.ZodString, z.ZodAny>;
    }, "strip", z.ZodTypeAny, {
        toolName: string;
        params: Record<string, any>;
    }, {
        toolName: string;
        params: Record<string, any>;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    /**
     * Concurrency follows the target: an MCP tool must declare `readOnlyHint`,
     * a builtin target answers with its own `isConcurrencySafe(params)`.
     */
    isConcurrencySafe(input: unknown): Promise<boolean>;
    protected readonly mcpManager: McpManager;
    protected readonly agentScopedMcpManager: AgentScopedMcpManager;
    protected readonly mcpConfigManager: McpConfigManager;
    protected readonly sessionManager: SessionManager;
    protected readonly agentManager: AgentManager;
    /**
     * Optional because ACP only exists when the CLI runs as an ACP backend
     * (Web UI, IDE, workbuddy-desktop). In SDK / headless mode this stays undefined
     * and MCP progress is silently dropped — same as before this feature existed.
     */
    protected readonly acpBroadcastService?: AcpBroadcastService;
    protected readonly toolRiskReviewService?: ToolRiskReviewServiceInterface;
    private validateCache;
    /**
     * Override needsApproval to support dual-mode permission matching:
     *
     * Phase 1: Check DeferExecuteTool's own permission rules.
     *   Supports rules like "DeferExecuteTool(*)" and "DeferExecuteTool(TeamCreate)".
     *   The targetToolName is passed as a Command arg so that
     *   "DeferExecuteTool(TeamCreate)" matches via matchCommandRule.
     *
     * Phase 2: Delegate to the target tool's permission check.
     *   Supports rules like "TeamCreate" and "TeamCreate(*)".
     *   This ensures each target tool's own permission rules still apply.
     */
    needsApproval: (runContext: RunContext<Session>, input: ToolExecuteArgument<any>, callId?: string) => Promise<boolean>;
    /**
     * Fallback: check permission against DeferExecuteTool itself.
     */
    private defaultNeedsApproval;
    private isMandatoryApprovalEnabled;
    /**
     * The call's `tool.call` names the target, as a direct call of it would (an
     * MCP target under its model name); a Mod's tool dispatches its own. The
     * target's availability and schema are checked when the call runs, beneath
     * the hooks.
     */
    toolCallTarget(input: unknown): ToolCallTarget | undefined;
    execute(input: z.infer<typeof DeferExecuteParameters>, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    /**
     * Public routing entry for callers outside the LLM tool-call path — currently the
     * REPL sandbox, whose preloaded tool globals dispatch through here.
     *
     * Differs from {@link execute} in two ways, both required by the REPL:
     *  1. **No deferred-index requirement.** The sandbox preloads *all* session tools,
     *     including non-deferred builtins (Bash/Read/...) that are absent from the
     *     ToolSearchService index. `execute` rejects those with "not found".
     *  2. **No param validation against the index.** Schema validation happens inside
     *     each execution path; the index may not hold a schema for inline builtins.
     *
     * Tool-availability filtering (`--tools` / agent whitelist) IS enforced here via
     * `checkToolAllowed`, same as {@link execute} — otherwise the REPL sandbox could
     * invoke a builtin (e.g. Bash) that the whitelist excludes, bypassing `--tools`.
     *
     * Interactive *permission* (approval prompting) is NOT done here — the caller must
     * run `checkPermission` itself (the REPL broker does, see mcp-code-mode-design.md
     * §4.8). Keeping approval outside avoids double-prompting when a caller has its own
     * approval semantics. Availability filtering and approval are distinct gates.
     */
    routeToolCall(toolName: string, params: Record<string, unknown>, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }, expectedMcpOwner?: string): Promise<ToolResult>;
    /**
     * Execute a built-in deferred tool via ToolManager.
     */
    private executeBuiltinTool;
    /**
     * Deny-only backstop for inherited restrictions at the Defer execution boundary.
     * Returns a denial ToolResult when a deny rule matches the final params.
     */
    private checkInheritedRestrictionDeny;
    /**
     * Execute an MCP tool via the MCP server's callTool method.
     *
     * MCP tools are not managed by ToolManager; they live on MCPServer instances.
     * Deferred MCP names can be canonical "mcp__serverName__rawToolName" or
     * bare names from transparent proxy, such as "connect_cloud_service".
     *
     * When `toolCallId` is available (i.e. running under an ACP backend) and an
     * `AcpBroadcastService` is wired, we install an `__onProgress` callback in
     * `meta` so MCP server progress notifications are broadcast as ACP
     * `tool_call_update` events with `metaData.mcpProgress`. The MCP renderer
     * (cb-chat-ui) reads that field and shows live progress in the UI.
     */
    private executeMcpTool;
    /**
     * 解析本次工具调用应透传的模型 ID。
     *
     * 优先级对齐 ModelConfigAgentRunInterceptor：
     *   session.requestOptions.model（运行时切模型：SDK set_model / ACP 切模型 / 命令 frontmatter）
     *   > session.options.model（--model 启动参数）
     *   > agent 默认模型（headless/-p 场景下前两者通常为空，这里回退保证 modelId 不丢）。
     *
     * agent 默认模型解析失败时静默返回 undefined：modelId 透传是“尽力而为”，
     * 不应因取模型失败而阻断工具调用。
     */
    private resolveCurrentModelId;
    /**
     * Convert MCP CallToolResultContent to ToolResult.
     *
     * @param content   工具返回的 content 数组（text/image/resource 块）
     * @param resultMeta CallToolResult 顶层的 structuredContent / _meta（经 sideband sink 捞回）。
     *                   存在 MCP Apps `_meta.ui` 等扩展时，挂到结果上供下游 ACP 透传渲染。
     */
    private convertMcpResult;
    /**
     * MCP Apps（io.modelcontextprotocol/ui）：委托共享广播实现。
     * 直连 FunctionTool 路径由 mcp-server-manager.callTool 出口同样调用该实现（#80575）。
     */
    private maybeBroadcastMcpUi;
    /**
     * Unified builtin deferred tool filtering check using getAllowedToolsForAgent.
     * MCP deferred tools, including bare-name transparent-proxy tools, bypass this
     * agent tool-name filter, but `mcp__` tools are still gated by the subagent MCP
     * whitelist (McpSubagentToolManager) when the current agent registered one.
     *
     * Returns a ToolResult error if blocked, or undefined if allowed.
     */
    private checkToolAllowed;
    /**
     * Normalize the nested `params` field before validation/dispatch.
     *
     * Weaker models sometimes double-encode this object field as a JSON string
     * (e.g. emit `params: "{}"` instead of `params: {}`). Since the SDK only
     * JSON.parses the outer tool arguments and does not coerce nested fields,
     * such a string would reach validateParams and fail with "root: must be
     * object", breaking every MCP tool routed through DeferExecuteTool.
     *
     * Only a string that parses into a plain object is unwrapped. Anything else
     * (already an object, or a string that is not a JSON object) is returned
     * unchanged so validateParams can still surface the original schema error.
     */
    private normalizeParams;
    /**
     * Recover long numeric IDs whose precision `JSON.parse` already destroyed.
     *
     * A JSON integer beyond `Number.MAX_SAFE_INTEGER` cannot survive parsing:
     * `1070198486138087566` becomes `1070198486138087600`, so the downstream tool
     * looks up a resource that does not exist. The exact digits only survive in the
     * raw tool-call arguments, so walk the raw JSON tree and put the original
     * literal back — as a string — before validation.
     *
     * No schema gate is applied. AJV runs next with `coerceTypes`, so a field the
     * schema declares as number is coerced straight back to a number (unchanged
     * behavior), while string-typed and schema-free fields keep the exact digits.
     * Gating on "schema says string" would miss the common proxy shape, where the
     * real business params are nested inside a free-form object (e.g. a connector's
     * `proxy_execute_tool(tool_name, tool_args)`) that the proxy schema declares
     * only as `type: object` and therefore says nothing about the inner ID.
     */
    private restoreUnsafeIntegerLiterals;
    /**
     * Walk a parsed container in lockstep with its raw JSON node. Recursion is
     * required because the corrupted ID is frequently nested: proxy tools carry
     * business params inside a free-form object, and batch APIs carry them in arrays.
     */
    private restoreUnsafeIntegersIn;
    private restoreUnsafeIntegerAt;
    private isPlainObject;
    private isDeferExecuteToolCall;
    private parseRawParamsNode;
    private shouldRestoreUnsafeInteger;
    /**
     * Validate params against a JSON Schema.
     * Returns a ToolResult with a detailed error message if validation fails, or undefined if valid.
     */
    private validateParams;
    private formatValidationError;
    private describeType;
    private collectTypesByJsonPointer;
    private valueAtJsonPointer;
    private describeExpectedType;
    /**
     * Parse the deferred MCP tool name format without importing mcp-utils, which
     * pulls in debug/session modules during isolated unit tests.
     */
    private parseMcpToolFullName;
    /**
     * Convert a bare-name MCP tool to the canonical mcp__server__tool name for permission matching.
     */
    private getMcpPermissionToolName;
    /**
     * 透明代理回退：当虚拟 server name（如 'playwright'）在 connectedServers 中不存在时，
     * 查找声明了对应 server/tool 路由的 transparent_proxy server。
     *
     * 兜底匹配策略（顺序，issue #49128）：
     * 1. 静态 toolsConfig 路由命中（启动期 mcp-config 显式声明 server_name 映射）—— 最强
     * 2. 运行期热补 toolsConfig 路由命中（mcp-server-manager 在 tools/list 响应里
     *    根据 _meta.serverName 写入的同 server_name 条目，issue #33921）—— 次强
     * 3. 透明代理回退（任意 transparent_proxy: true 的 server）—— 兜底，应对
     *    set(DYNAMIC) 反复覆盖 toolsConfig 导致两层路由都 miss 的间隙
     *
     * 路径 3 的安全性论证：
     * - 只对 mcp__<X>__<Y> 形态的调用生效（caller 已经判定 isPrefixedMcpTool）
     * - 透明代理 server (connector-proxy) 的 callTool 反向路由
     *   (mcp-server-manager.ts:364-368) 会把 mcp__lexiang__xxx 转回 lexiang_xxx
     *   传给 proxy；proxy 内部按 short name 找到 client，找不到就返回 MCP error，
     *   等价于 "工具未连接" 的语义错误，不会越权调到其它 server
     * - 路径 1/2 命中时不进入 3，所以 ardot / netdrive 显式预塞的兜底语义保留
     */
    private findTransparentProxyServer;
    /**
     * 裸名 MCP 工具没有 server 前缀，只能通过 transparent_proxy 配置定位实际 MCP server。
     */
    private findTransparentProxyServerForBareTool;
}
export {};
