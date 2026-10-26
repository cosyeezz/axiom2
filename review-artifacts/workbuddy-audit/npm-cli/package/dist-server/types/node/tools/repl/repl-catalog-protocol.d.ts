/**
 * REPL 发现 API 契约 —— 沙箱运行时（searchTools / describeTool / worker 注入）的共享类型。
 *
 * 设计见 docs/repl-code-mode/mcp-code-mode-design.md §4.3。
 * 要点:
 *  - 只有一份目录产物(骨架目录),档 A 给工具级明细 / 档 B 给 server 级索引,合起来全量收录。
 *  - 没有枚举 API:"有哪些工具"读骨架目录即可,零调用零 token。
 *  - 发现 API 只补骨架做不到的两件事:档 B 里找工具(searchTools)、完整 schema(describeTool)。
 *
 * 目录产物（`REPLCatalog` 一族）、`ReplCatalogSource` token 与沙箱前缀是宿主也要用的契约，
 * 在 agent/code-mode-protocol.ts；本文件只留 REPL 内部用的部分。
 */
import type { REPLToolCategory } from '../../agent/code-mode-protocol';
export interface SearchToolsOptions {
    /** 默认 10，钳制到 [1, 50]。上限防止拿它当枚举用——枚举应读骨架目录。 */
    topK?: number;
    category?: REPLToolCategory;
    /** 只搜某个 MCP server（隐含 category: 'mcp'）。 */
    server?: string;
}
export interface ToolSearchHit {
    /** 模型面调用名，可直接当 describeTool 的入参。 */
    name: string;
    category: REPLToolCategory;
    server?: string;
    /** 一行摘要（按 SUMMARY_MAX_CHARS 截断——索引里存的是 full description）。 */
    description: string;
    /** BM25 相关度，降序。 */
    score: number;
}
export interface ToolDescriptor {
    name: string;
    category: REPLToolCategory;
    description: string;
    /** 完整 JSON Schema（含嵌套结构、约束与逐字段描述）。 */
    parameters: Record<string, unknown>;
    server?: string;
    serverToolName?: string;
}
export interface BridgeEntry {
    /** 桥标识："@wb/browser"。 */
    specifier: string;
}
/** worker 侧注入 sandbox 全局所需的最小描述（结构化克隆友好）。 */
export interface REPLToolDescriptor {
    name: string;
    displayName: string;
    category: REPLToolCategory;
    server?: string;
    serverToolName?: string;
}
/** init / toolsUpdate 推给 worker 的载荷。 */
export interface REPLToolsPayload {
    epoch: number;
    /**
     * 本会话能力指纹（表面 / 身份 / 可见频道集合，见 repl-sandbox-capability）。
     *
     * worker 的去重键是 `(epoch, capability)` **两者一起**：能力变化时 epoch 可以不变
     * （indexEpoch / surfaceEpoch 都不动），只按 epoch 去重会把这次重推静默丢掉 ——
     * 新加入的频道工具于是永远停在 `undefined`。
     */
    capability?: string;
    builtins: REPLToolDescriptor[];
    /** logical server 原始键 → 原始工具名、canonical 与物理 owner 的映射。 */
    servers: Array<{
        globalName: string;
        server: string;
        tools: Array<{
            method: string;
            canonical: string;
            owner?: string;
        }>;
    }>;
}
export declare const REPL_SEARCH_TOOLS_DEFAULT_TOP_K = 10;
export declare const REPL_SEARCH_TOOLS_MAX_TOP_K = 50;
/** describeTools 的条数上限：精准批量，不是全量拉取。 */
export declare const REPL_DESCRIBE_TOOLS_MAX = 10;
