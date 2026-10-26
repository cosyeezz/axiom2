/**
 * The one place that turns an MCP tool name into the form the model sees, and
 * matches whitelist or permission patterns against either form.
 *
 * `@openai/agents-core` converts every MCP tool into a FunctionTool named
 * `toFunctionToolName(raw)`: whitespace and any other non-alphanumeric character
 * become `_`. The CLI keeps the raw name as the tool's identity (the MCP index,
 * the ToolSearch listing, Defer lookup) and converts only where a name crosses
 * the SDK boundary: matching an SDK-converted declaration back to its raw name,
 * and the SDK's approval record of a call. This module has no imports, so
 * synchronous callers (the search index, permission matching) never load the
 * SDK's utils barrel; `mcp-tool-name.spec.ts` pins it to the SDK conversion.
 */
/**
 * MCP 工具名归一化，与 @openai/agents-core 的 toFunctionToolName 对齐
 * （非字母数字字符 → 下划线；下划线自身不受影响，因此 `__` 结构分隔符保持完整）。
 * LLM 可见的工具名经过该归一化，而内部代理壳 tool.name 保留原始名（含连字符），
 * 白名单/权限匹配前必须把两侧统一到同一形态，否则 `mcp__web_search__*` 匹配不到
 * 原始名 `mcp__web-search__x`。
 * `*` 原样保留：它是白名单/权限规则的通配标记，真实工具名不会包含该字符。
 */
export declare function normalizeMcpToolName(name: string): string;
/**
 * The SDK function name of a tool, without loading the SDK: `*` is a name
 * character here, not a rule wildcard, and the empty name fails as in the SDK.
 */
export declare function toModelToolName(name: string): string;
/**
 * MCP 工具名模式匹配（tools 白名单语义，与 CC 一致）：
 * - `mcp__server__tool` 精确匹配
 * - `mcp__server` / `mcp__server__*` 匹配该 server 下全部工具
 * - `mcp__*` 在白名单侧**不支持**（CC 同样不识别，落入 unresolvable）；
 *   全通配只在 disallowedTools（deny）侧有意义。
 *
 * pattern 与 toolName 两侧先做 toFunctionToolName 等价归一化再比较（见
 * normalizeMcpToolName），配置里写归一化名或原始名都能命中。
 *
 * 大小写（P3 已知不一致）：本侧（allow/白名单）大小写敏感（normalizeMcpToolName
 * 不转小写），而 deny 侧 permission-utils.matchMcpPermissionRules 会两侧 toLowerCase。
 * 二者语义不一致（如 `mcp__GitHub` 能被 deny 屏蔽却授权不到）——是否统一取决于
 * CC toolMatchesRule 是否大小写敏感；未核实前保持现状，不盲目统一。
 */
export declare function matchesMcpToolPattern(pattern: string, toolName: string): boolean;
