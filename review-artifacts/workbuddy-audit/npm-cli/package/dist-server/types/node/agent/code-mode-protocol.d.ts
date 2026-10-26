/**
 * Code Mode 宿主侧契约 —— 宿主（agent 层等）对 REPL 的全部依赖都落在这里。
 *
 * 方向与 cbc-* 拆包同款：`tools/repl/` 是可整体出图的实现臂，单向依赖本文件（采集层实现
 * `ReplCatalogSource`，目录构造用同一套逻辑调用名）；宿主经 `@Optional()` 注入消费，不 import
 * `tools/repl/` 下的任何文件。server 产物（workbuddy 工具预设不含 REPL）会把 `tools/repl/`
 * 整个目录置空，宿主若从那里取值，运行时拿到的是 undefined —— 构建本身不报错，由
 * `src/hooks/server-tools-exclude-guard.ts` 在出包前拦截。
 *
 * 只放常量、DI token 与类型，不 import 运行时模块：main-agent-session 依赖本文件，反向会成环。
 * 目录设计见 docs/repl-code-mode/mcp-code-mode-design.md §4.3。
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { RunContext } from '@openai/agents';
/**
 * REPL 总闸 env。开启 code-mode(REPL 工具暴露 + 骨架目录注入)的唯一开关。
 * 判定实现是 main-agent-session 的 `isReplEnabled`，REPLTool（isEnabled / 骨架渲染）与
 * AgentManager（首轮 MCP prewait 判定）共用，避免各处内联 env 判定漂移。
 */
export declare const REPL_ENABLED_ENV = "CODEBUDDY_REPL_ENABLED";
/** 模型面 MCP 始终置于顶层 mcp 下，物理 owner 只用于路由与权限。 */
export declare function mcpLogicalServerName(canonical: string, owner: string, rawToolName: string): string | undefined;
/**
 * Proxy 属性名里不能映射成 MCP 工具的保留名：
 * - `toJSON`：JSON.stringify / console.log 会隐式访问，映射过去会触发真实工具调用；
 * - `then` / `inspect`：`await server` 与宿主 inspect 会探测，映射成工具会让等待挂住。
 * 目录侧必须用同一份集合过滤，否则会出现「目录里看得到但调不动」。
 */
export declare const MCP_RESERVED_TOOL_SEGMENTS: ReadonlySet<string>;
/** 保留 MCP 原始 server / tool 名；非 JS 标识符使用方括号访问而非折叠命名。 */
export declare function mcpSandboxSegment(name: string): string;
export declare function mcpSandboxServerName(server: string): string;
export declare function mcpSandboxToolName(server: string, tool: string): string;
/** 工具归属：内置工具占顶层全局，MCP 工具收在 server 二级命名空间下。 */
export type REPLToolCategory = 'builtin' | 'mcp';
/** 采集层产出的单个工具元信息（渲染骨架与注入 sandbox 共用）。 */
export interface REPLCatalogTool {
    /** Runtime Mod tools remain callable, but their prompt detail can be discovered on demand. */
    runtime?: boolean;
    /** canonical 路由名："Bash" / "mcp__github__list_pull_requests"。 */
    name: string;
    /** 模型面调用名："Bash" / "mcp.github.list_pull_requests"。 */
    displayName: string;
    category: REPLToolCategory;
    /** 一行摘要（渲染时再按预算截断）。 */
    summary: string;
    /**
     * 沙箱返回值形状，渲染在参数骨架后面、摘要前面。
     * 必须单独成字段：摘要会被 SUMMARY_MAX_CHARS 截断，返回值不能被吃掉。
     */
    returns?: string;
    /** JSON Schema；渲染骨架与 describeTool 都用它。 */
    parameters: Record<string, unknown>;
    /** MCP 逻辑 namespace（category==='mcp' 时必有）；canonical 路由名不变。 */
    server?: string;
    /** MCP 物理 owner，用于路由和 repl_expose 授权，不作为模型调用名。 */
    owner?: string;
    /** MCP 原始 tool name。 */
    serverToolName?: string;
}
/** 一个 MCP server 及其工具（分档的最小单位——整组降档，不半截）。 */
export interface REPLCatalogServerGroup {
    /** 模型面逻辑 server 名（用于 `{server}` 过滤）。 */
    server: string;
    /** mcp 子树的原始属性键名（与 server 相同）。 */
    globalName: string;
    description?: string;
    tools: REPLCatalogTool[];
}
/** 采集层产物。骨架渲染与 sandbox 注入同源于此，避免两处口径漂移。 */
export interface REPLCatalog {
    /** 内置工具（延迟 + 非延迟合并后）。 */
    builtin: REPLCatalogTool[];
    mcp: REPLCatalogServerGroup[];
    /** 目录版本号 = ToolSearchService.indexEpoch，用于新鲜度对账（§4.3.4）。 */
    epoch: number;
}
export declare const ReplCatalogSource: unique symbol;
/**
 * 目录采集层 —— **无状态**：每次 collect 现采，不缓存。实现在 tools/repl/repl-catalog-source.ts；
 * 宿主侧一律 `@Optional()` 注入，REPL 出图的产物里拿到 undefined。
 *
 * 不缓存的理由：调用频率极低（agent 构建时一次，见 §4.3.4「注入时机与生产次数」），
 * 而缓存 key 需覆盖 agent 白名单 / session --tools / overlay / 动态 shouldShow 四个维度
 * 并跟随 indexEpoch 失效——失效逻辑比重新采集更贵，且易出 stale bug。
 */
export interface ReplCatalogSource {
    /**
     * 采集当前会话可见的全部工具。
     *
     * 收 `RunContext` 而非 `Session`：agent 工具白名单入口
     * `getAllowedToolsForAgent(agentName, context)` 需要 RunContext 才能跑
     * `isEnabled`，且 RunContext 无法从 Session 反推（§4.3.3 易漏点 ①）。
     *
     * `opts.sandboxAgentName`：沙箱身份覆盖（见 ReplCatalogSource 实现的说明 ——
     * Code Mode 的 REPL schema 在共享 agent 实例上物化，分子代理目录要靠派发侧传身份）。
     */
    collect(context: RunContext<Session>, opts?: {
        sandboxAgentName?: string;
    }): Promise<REPLCatalog>;
}
