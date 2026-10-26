import { Session } from '../../vendor/cbc-core/node/index.js';
import { PermissionUpdate, RuleValue, SettingSource, ToolArg, ToolPermissionContext } from '../../vendor/cbc-shared/node/index.js';
export interface PermissionRule {
    permission: string;
    rule: string;
}
export interface PermissionRuleMatch extends PermissionRule {
    arg?: ToolArg;
}
export declare abstract class PermissionUtils {
    /** Same deny sources as ToolPermissionService; never borrow the global current session. */
    static collectSessionDenyRules(session?: Session | null): string[];
    /** Only whole-tool rules hide declarations. Argument-scoped rules remain execution checks. */
    static isWholeToolDenied(rules: string[], names: string[]): boolean;
    private static getDebugService;
    static checkSafeyPermission(toolNames: string[], args: ToolArg[]): boolean;
    /**
     * 从规则数组中根据 tool 名称匹配找出具体规则
     * 如 Bash(npm run build) 中，匹配出 npm run build
     * @param permissions 权限列表
     * @param toolNames 工具名/别名
     * @return 规则列表
     */
    static matchPermissionRules(permissions: string[] | undefined, toolNames: string[]): PermissionRule[];
    /**
     * MCP 专用权限匹配方法
     * MCP 权限格式: mcp__<server_name>、mcp__<server_name>__<tool_name> 或 mcp__<server_name>__*
     * 支持通配符,采用精确匹配或服务器级别匹配
     *
     * 规则与工具名两侧先做 toFunctionToolName 等价归一化（见 normalizeMcpToolName）再比较：
     * LLM 可见名（`mcp__web_search__x`）与内部原始名（`mcp__web-search__x`）都能命中。
     *
     * `mcp__*` 全通配只在 deny/ask 侧生效；allow 侧（options.allowSide）不匹配任何工具
     * （对齐 Claude Code 与 changeset 自述语义）。
     * @param permissions 权限列表
     * @param toolNames MCP 工具名列表
     * @param options.allowSide 调用方是 allow 规则检查时为 true
     * @return 匹配的权限规则列表
     */
    static matchMcpPermissionRules(permissions: string[] | undefined, toolNames: string[], options?: {
        allowSide?: boolean;
    }): PermissionRule[];
    /**
     * 判断规则列表是否匹配执行参数
     * @param rules 规则列表
     * @param args 执行参数列表
     * @return 是否匹配
     */
    static checkPermissionRules(rules: PermissionRule[] | undefined, args: ToolArg[]): boolean;
    /**
     * Check if allow rules match the given arguments.
     *
     * Unlike checkPermissionRules (used for deny/ask), this method requires ALL
     * sub-commands in a compound command to match the rule for it to be allowed.
     * This prevents a safe allow rule like Bash(cd:*) from inadvertently allowing
     * dangerous compound commands like "cd /path && git reset --hard".
     */
    static checkAllowPermissionRules(rules: PermissionRule[] | undefined, args: ToolArg[]): boolean;
    static findMatchingPermissionRule(rules: PermissionRule[] | undefined, args: ToolArg[], options?: {
        requireAllSubcommands?: boolean;
    }): PermissionRuleMatch | undefined;
    /**
     * 匹配文件路径规则（使用 minimatch 进行 glob 匹配）
     * @param {string} filePath 输入路径
     * @param {string} pattern 匹配模式
     * @returns {boolean} 是否匹配
     */
    static matchFileRule(filePath: string, pattern: string): boolean;
    static normalizePath(rawPath: string): string;
    static normalizeFilePathPattern(pattern: string): string;
    /**
     * 匹配 Bash 命令规则
     *
     * 支持复杂命令匹配：对于包含 &&, ||, |, ; 等操作符的复杂命令，
     * 会提取所有子命令并逐一匹配规则。例如 "git:*" 规则可以匹配
     * "cd /xx/yy && git status" 命令，因为其中包含 "git status" 子命令。
     *
     * 规则类型：
     * - 精确匹配: "git status" 只匹配 "git status"
     * - 前缀匹配: "git:*" 匹配 "git", "git status", "git diff" 等
     * - 通配符匹配: "npm run *" 匹配 "npm run build", "npm run test" 等
     *
     * @param {string} input 输入命令（可能是复杂的组合命令）
     * @param {string} pattern 匹配模式
     * @returns {boolean} 是否匹配（任一子命令匹配即返回 true）
     */
    static matchCommandRule(input: string, pattern: string): boolean;
    /**
     * 检查命令是否是复杂命令（包含 shell 操作符）
     */
    private static isComplexCommand;
    /**
     * Get the CommandParserService instance
     */
    private static getCommandParserService;
    /**
     * 同步提取子命令
     *
     * 使用 CommandParserService 提取所有子命令。服务内部会根据可用性
     * 自动选择最佳解析策略（tree-sitter > shell-quote > regex）。
     */
    private static extractSubcommandsSync;
    /**
     * Regex fallback for extracting subcommands when ShellParserService is not available
     */
    private static extractSubcommandsWithRegex;
    /**
     * 匹配单个命令（不含 shell 操作符）
     *
     * 支持三种匹配模式：
     * 1. 精确匹配: pattern 完全等于命令
     * 2. 前缀匹配: pattern 以 :* 结尾，匹配命令的第一个词
     * 3. 通配符匹配: pattern 包含 * 但不是 :* 结尾
     */
    private static matchSingleCommandAgainstPattern;
    /**
     * 匹配 Skill 规则
     * @param {string} skillName Skill 名称
     * @param {string} pattern 匹配模式
     * @returns {boolean} 是否匹配
     */
    static matchSkillRule(skillName: string, pattern: string): boolean;
    /**
     * 检查命令是否被规则允许
     *
     * 对于复杂命令，需要所有子命令都匹配规则才返回 true。
     * 这与 matchCommandRule 不同，后者只需要任一子命令匹配即可。
     *
     * 注意：此方法用于 allow 规则检查，要求更严格。
     *
     * @param pattern 匹配模式
     * @param command 命令字符串
     * @returns 是否允许
     */
    static isCommandAllowed(pattern: string, command: string): boolean;
    /**
     * 匹配单个命令（用于内部调用，保持向后兼容）
     * @deprecated 请使用 matchSingleCommandAgainstPattern
     */
    static matchSingleCommand(pattern: string, command: string): boolean;
    /**
     * 匹配 URL 规则
     * @param {string} input 输入命令
     * @param {string} pattern 匹配模式
     * @returns {boolean} 是否匹配
     */
    static matchURLRule(url: string, pattern: string): boolean;
    static getDomainFromUrl(url: string): string | undefined;
    static extractWholeToolRules(permissions?: string[]): string[];
    private static isScopedPermission;
    static isArgsInTrustedDirectories(checkArgs: ToolArg[], session?: Session): Promise<boolean>;
    static isInTrustedDirectories(targetPath: string, session?: Session): Promise<boolean>;
    /**
     * Check if a target path is within a trusted directory path.
     * Supports both exact paths and glob patterns (e.g., /path/** for recursive trust).
     *
     * @param dirPath - The trusted directory path, may contain glob patterns like /path/**
     * @param targetPath - The target file path to check
     * @returns true if target is within the trusted directory
     */
    static isWithin(dirPath: string, targetPath: string): boolean;
    /**
     * Create an empty/default ToolPermissionContext
     */
    static createDefaultToolPermissionContext(): ToolPermissionContext;
    /**
     * Parse a rule string into a RuleValue
     * Format: "ToolName" or "ToolName(ruleContent)"
     * Examples:
     *   - "Read" -> { toolName: "Read" }
     *   - "Bash(npm run build)" -> { toolName: "Bash", ruleContent: "npm run build" }
     *   - "Edit(*.json)" -> { toolName: "Edit", ruleContent: "*.json" }
     */
    static parseRuleString(ruleString: string): RuleValue;
    /**
     * Convert a RuleValue back to a rule string
     */
    static ruleValueToString(rule: RuleValue): string;
    /**
     * Merge all rules from all sources into a single array
     */
    static mergeRulesFromAllSources(rulesBySource: Record<SettingSource, string[]>): string[];
    /**
     * Apply a permission update to the context
     * Returns a new context (immutable update)
     *
     * Note: 'setMode' updates are handled separately via session.permissionModeSubject
     */
    static applyPermissionUpdate(context: ToolPermissionContext, update: PermissionUpdate): ToolPermissionContext;
}
