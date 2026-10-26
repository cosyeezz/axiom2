export declare const TRUSTED_BUILTIN_CANDIDATE_TOOLS: Set<string>;
/**
 * 返回内容完全由宿主生成的内置 MCP 工具，其结果免于防注入检测。
 * 仅在工具同时携带受信 sensitiveResultPolicy 时生效；返回外部或用户数据的内置工具不得加入。
 */
export declare const TRUSTED_HOST_RESULT_TOOLS: Set<string>;
/** 仅当宿主声明发现目录可信时，其返回免于防注入检测；判定见 isHostTrustedA2aSource。 */
export declare const A2A_RESULT_TOOLS: Set<string>;
export declare const IN_SCOPE_BUILTIN_TOOL_NAMES: readonly ["Bash", "PowerShell", "Write", "Edit", "MultiEdit", "NotebookEdit", "Read", "Glob", "Grep", "WebFetch", "WebSearch"];
export type InScopeBuiltinToolName = typeof IN_SCOPE_BUILTIN_TOOL_NAMES[number];
export declare const IN_SCOPE_BUILTIN_TOOLS: Set<string>;
export declare function isToolRiskReviewInScope(toolName: string): toolName is InScopeBuiltinToolName;
export declare function isToolRiskIdentityInScope(identity: import('./protocol').ToolIdentity): boolean;
