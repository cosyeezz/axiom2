/**
 * ReplCatalogSource —— 骨架目录与发现 API 的统一采集层（主线程）。
 *
 * 设计见 docs/repl-code-mode/mcp-code-mode-design.md §4.3.2「目录数据源」。
 *
 * 三个数据源，各补一块：
 *  - ToolSearchService.listDeferredToolInfosForSession() → 全局及会话延迟工具，带 parameters
 *  - ToolManager.listRegisteredTools()        → 非延迟内置工具（不在延迟索引里）
 *  - McpManager.getConnectedServers()         → 补"已连接但尚无工具"的空分组
 *
 * **无状态**：每次 collect 现采、不缓存。理由见 protocol 里 ReplCatalogSource 的注释。
 */
import type { Session } from '../../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { REPLCatalog, ReplCatalogSource } from '../../agent/code-mode-protocol';
import { CliRuntimeOptions } from '../../cli/cli-runtime-options';
import { AgentScopedMcpManager, McpManager } from '../../mcp/mcp-protocol';
import { ToolManager } from '../tool-protocol';
import { ToolSearchService } from '../tool-search-protocol';
import { AgentToolDeferOverlayCache } from '../tool-spec';
export declare class ReplCatalogSourceImpl implements ReplCatalogSource {
    protected readonly logger: Logger;
    protected readonly toolSearchService: ToolSearchService;
    protected readonly toolManager: ToolManager;
    protected readonly overlayCache: AgentToolDeferOverlayCache;
    protected readonly mcpManager?: McpManager;
    protected readonly agentScopedMcpManager?: AgentScopedMcpManager;
    protected readonly cliRuntimeOptions?: CliRuntimeOptions;
    /**
     * @param opts.sandboxAgentName 采集用的**沙箱身份**覆盖（缺省按 session 推）。
     *   Code Mode 的 REPL 工具 schema 在 agent 构建期物化，那一刻用的是合成会话（没有子会话身份），
     *   继承模式的子代理就会拿到「模式的全量目录」而不是自己的白名单。派发侧知道子代理身份，
     *   经此显式传入（见 AgentManager.sandboxScopedAgentView）。运行时路径（broker / worker）
     *   仍然按 live session 推，不受影响。
     */
    collect(context: RunContext<Session>, opts?: {
        sandboxAgentName?: string;
    }): Promise<REPLCatalog>;
    /**
     * 构建期兜底：当 live session 未携带 `--tools`（agent 构建早于会话建立，
     * getCurrent() 为 undefined）时，用进程级 CliRuntimeOptions 的 `--tools`
     * 合成一个带 options.tools 的 context，交给 getAllowedToolsForAgent 走同一套
     * 白名单解析。
     *
     * 优先级与 ToolManager.resolveSessionToolContext 对齐：live session 已有
     * options.tools 时**不覆盖**（它是权威值）；仅在缺失时才回退到 CLI 快照。
     * 未装配 CliRuntimeOptions（headless/单测）或无 `--tools` 时原样返回。
     */
    private contextWithCliTools;
    private ensureGroup;
    private appendEmptyServerGroups;
    /**
     * 采集全部 MCP server 的配置，建立 serverName → McpConfig 映射，供 repl_expose 判定用。
     * 失败时返回空 map —— 白名单默认 false，等价于"任何 MCP 都不暴露给沙箱"，安全兜底。
     */
    private collectServerConfigs;
    /**
     * repl_expose 白名单判定（仅约束 MCP 工具，内置工具不走此路径）。
     * 只认 server 级：显式 repl_expose:true 才暴露，其余（含未配置）一律默认 false。
     */
    private isReplExposed;
    private toBuiltinTool;
    /**
     * 整工具级 deny 规则命中的**内置**工具名集合（MCP 由调用方按单名逐个判）。
     *
     * 与 `AgentManager.isToolDisallowed` 严格同口径：匹配时**带上 aliases**——
     * `--disallowed-tools read` 要能同时命中 LSP / BashOutput 等把 `read` 声明为
     * 别名的工具（isToolDisallowed 用的是 `[toolName, ...aliases]`）。
     *
     * 无任何 deny 规则时立刻返回，避免为绝大多数会话白跑一遍 O(工具数×规则数)。
     */
    private collectWholeToolDenyNames;
    private toMcpTool;
    /** 注册在本地 ToolManager 的 Mod 工具允许从其 mcp__ 形状恢复逻辑 namespace。 */
    private serverNameOf;
    /**
     * 内置工具的 agent 白名单判定：与 ToolSearchService.isAllowedByAgentTools 同口径
     * （MCP 工具豁免，内置工具必须显式启用）。
     */
    private isAllowedBuiltin;
    /**
     * PTC 跳过直连白名单之后，仍要过工具自己的 isEnabled。
     * 否则 WorkBuddy 的沙箱骨架会列出 SpeakInChannel / MessageColleague。
     */
    private isSandboxToolEnabled;
    /**
     * 归一化成 JSON Schema。三种入参形态都要处理：
     *  - 已是 JSON Schema 对象 → 原样
     *  - zod schema → `zodToJsonSchema`
     *  - **函数**（`parameters(): ZodTypeAny` / `async () => ...`）→ 先调用再转
     *
     * 第三种必须处理：`ToolManager.init()` 对函数式 `parameters` **刻意跳过**转换
     * （留给 `get()` 时动态生成），而这里走 `listRegisteredTools()` 拿的是原始 toolMap，
     * `parameters` 仍是函数。漏掉它会让 Bash / PowerShell / Agent / StructuredOutput
     * 在骨架目录里渲染成无参的 `Bash()` —— 而 Bash 恰是价值最高的工具。
     *
     * 函数必须带 `thisArg`：Agent 的 `parameters()` 是 `return this.buildParametersSchema()`，
     * 抽成裸 `()` 调用会在 strict 下把 schema 打成 `{}`。
     */
    private asJsonSchema;
}
