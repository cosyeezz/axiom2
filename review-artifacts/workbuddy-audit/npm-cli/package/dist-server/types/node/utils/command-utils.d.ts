import { SandboxBlockContext } from './wb-command-policy';
/**
 * 终端命令安全检查工具
 */
export declare enum RiskLevel {
    SAFE = "safe",// 安全：无需确认
    LOW = "low",// 低风险：需要确认，可缓存
    MEDIUM = "medium",// 中风险：需要确认，可缓存
    HIGH = "high",// 高风险：每次都需要确认，不可缓存
    CRITICAL = "critical"
}
export interface CommandSafetyCheck {
    isSafe: boolean;
    requiresApproval: boolean;
    riskLevel: RiskLevel;
    /** 命令未被任何白名单或已知风险模式识别，属于兜底判定。仅在兜底分支设置为 true。 */
    isUnknown?: boolean;
    reason?: string;
}
export declare const SAFE_COMMAND_WHITELIST: string[];
export declare const SAFE_EXCEPTION_PATTERNS: RegExp[];
export declare const CRITICAL_COMMAND_PATTERNS: RegExp[];
export declare const HIGH_RISK_COMMAND_PATTERNS: RegExp[];
export declare const MEDIUM_RISK_COMMAND_PATTERNS: RegExp[];
/**
 * 命令前缀提取结果
 */
export interface CommandPrefixResult {
    prefix: string;
}
/**
 * Strip heredoc bodies from a command string so that only the shell
 * command itself is checked against safety rules.
 *
 * Supports all common heredoc forms:
 *   cmd << EOF\n...\nEOF
 *   cmd << 'EOF'\n...\nEOF
 *   cmd << "EOF"\n...\nEOF
 *   cmd <<- EOF\n...\nEOF   (indented)
 *
 * Returns the command with heredoc bodies removed (delimiter lines kept
 * to preserve the structural intent of the command).
 */
export declare function stripHeredocBodies(command: string): string;
export declare abstract class CommandUtils {
    /**
     * 从 Bash 命令中提取命令前缀，用于权限规则匹配
     *
     * 参考 Claude Code policy_spec 中的前缀提取规则：
     * - 前缀 = 环境变量 + 命令词 + 子命令词（跳过 flag 和参数）
     * - 如果命令词+子命令后无更多参数 → 'none'
     *
     * 示例：
     * - "cat foo.txt" → "cat"
     * - "git commit -m 'foo'" → "git commit"
     * - "git push" → "none"（无额外参数）
     * - "git push origin master" → "git push"
     * - "npm run lint" → "none"（无额外参数）
     * - "npm run lint -- 'foo'" → "npm run lint"
     * - "GOEXPERIMENT=synctest go test -v ./..." → "GOEXPERIMENT=synctest go test"
     */
    static extractCommandPrefix(command: string): CommandPrefixResult;
    static isCommandAvailable(command: string): Promise<boolean>;
    /**
     * 检查命令安全性
     * @param command 要检查的命令
     * @returns 安全检查结果
     */
    /**
     * 风险等级优先级，数值越大风险越高
     */
    private static readonly RISK_PRIORITY;
    /**
     * 检查单条命令（不含分隔符）的安全性
     */
    private static checkSingleCommandSafety;
    /**
     * 检查命令安全性
     * @param command 要检查的命令
     * @param sandboxContext 可选的沙盒运行时上下文（post-exec 拦截时传入，用于更精确的风险判定）
     * @returns 安全检查结果
     */
    static checkCommandSafety(command: string, sandboxContext?: SandboxBlockContext): CommandSafetyCheck;
    /**
     * 对单条命令执行完整的安全检查：通用策略 + 产品级后置策略。
     *
     * 先跑通用 checkSingleCommandSafety 拿到基础结果，
     * 仅在 WorkBuddy Desktop 环境下才走 applyWorkBuddyCommandPolicy 做二次判定。
     */
    private static checkSingleCommandWithProductPolicy;
    /**
     * 检查依赖 shell 分隔符语义的危险模式（必须在拆分前匹配）。
     *
     * 这些模式的危险性来自"管道/链式调用本身"：
     *  - `curl ... | bash|sh|zsh|ksh` / `wget ... | bash|sh|zsh|ksh` — 供应链攻击经典模式
     *    （支持 `curl url | tee foo.sh | bash` 等中间带其他过滤的多级管道）
     *  - `... | xargs rm/unlink` — 批量删除
     *
     * 若拆分成子命令后单独判断，会降级成 "curl(SAFE) + bash(unknown LOW)"，
     * 无法反映真实风险。因此在拆分前先集中拦截。
     *
     * 已知缺口（不在本拦截层处理）：
     *  - 命令替换 `$(curl url)` / 反引号形态——现有子命令替换检测在 HIGH_RISK 处理
     *  - 先下载后分步执行 `curl -o x.sh url; bash x.sh`——`bash x.sh` 未列白名单，仍会走
     *    未知命令 LOW + requiresApproval，不会真正放行
     */
    private static checkCrossSeparatorDangerousPatterns;
    /**
     * 获取命令风险级别对应的图标和提示文案
     * @param command 要检查的命令
     * @returns 风险图标和提示文案
     */
    static getCommandRiskInfo(command: string): string;
}
