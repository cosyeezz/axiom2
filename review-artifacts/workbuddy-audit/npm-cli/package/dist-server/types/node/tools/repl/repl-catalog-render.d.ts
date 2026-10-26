/**
 * 骨架目录渲染 —— 把 REPLCatalog 渲成拼进 `code` 参数描述的纯文本。
 *
 * 设计见 docs/repl-code-mode/mcp-code-mode-design.md §4.3.2。
 *
 * 分档降级（档 A/B）是本文件的核心：
 *  - 档 A（工具级，~100B/工具）：每工具一行 `name({ 参数骨架 }) — 描述`
 *  - 档 B（server 级，~70B/server）：一行 `name (N tools) — 描述`
 *
 * 降级单位是 **server 整组**，不半截——半截会让模型以为该 server 只有那几个工具。
 * 档 B 体积几乎不随工具数增长，所以任意规模都装得下：装不下的只是档 A。
 */
import { REPLCatalog, REPLCatalogServerGroup, REPLCatalogTool } from '../../agent/code-mode-protocol';
/** 骨架总预算，对齐 DEFAULT_DEFERRED_TOOLS_CHAR_BUDGET（~20000 chars ≈ ~5000 tokens）。 */
export declare const SKELETON_CHAR_BUDGET = 20000;
/** 单工具最多列几个顶层参数，超出记 `…+N`。 */
export declare const MAX_PARAMS_PER_TOOL = 6;
/** 单工具一行摘要的截断长度（searchTools 的出参共用该常量）。 */
export declare const SUMMARY_MAX_CHARS = 80;
/** 档 B 里 server 描述的截断长度。 */
export declare const SERVER_DESC_MAX_CHARS = 100;
export declare function truncate(text: string, max: number): string;
/**
 * 类型渲染：枚举原样列出（≤4 项），数组给壳，嵌套对象一律折叠成 `object`。
 *
 * 折叠是刻意的——完整嵌套 schema 可达数 KB（实测 AskUserQuestion 3966B vs 骨架 73B，
 * 54 倍）。代价是 `object` 对模型是信息不足的信号，因此兜底说明必须告诉它
 * "看到 object 就调 describeTool"，否则模型会把它当成"接受任意对象"。
 */
export declare function renderType(def: unknown): string;
/**
 * 从 JSON Schema 派生单个参数对象的骨架：只取顶层 properties，必填优先。
 *
 * REPL 预注入函数的运行时契约始终是 `Tool(params)`，不是多个位置参数。这里必须
 * 保留对象花括号；否则 `Artifact(filePath: string, ...)` 会误导模型传入字符串，导致
 * 工具侧收到的 `input.filePath` 为 undefined。
 */
export declare function renderParameterSkeleton(schema: Record<string, unknown> | undefined): string;
/** 档 B 一行：`name (N tools) — description`。 */
export declare function renderServerTierB(group: REPLCatalogServerGroup): string;
export interface TierAllocation {
    tierA: REPLCatalogServerGroup[];
    tierB: REPLCatalogServerGroup[];
}
/**
 * 档 A/B 分配：builtin 无条件档 A（不参与预算竞争）；MCP 按工具数升序填至预算，
 * 溢出的整组降档 B。
 *
 * 按工具数升序是性价比优先：一个小 server 只要几百字节，先进档 A 能覆盖更多 server。
 */
export declare function allocateTiers(builtin: REPLCatalogTool[], mcpGroups: REPLCatalogServerGroup[], budget?: number): TierAllocation;
/**
 * 渲染骨架目录全文。档 A + 档 B 合起来**全量收录**——所以模型读它即知会话里有什么，
 * 不需要任何枚举 API。
 */
export declare function renderSkeletonCatalog(catalog: REPLCatalog, budget?: number): string;
