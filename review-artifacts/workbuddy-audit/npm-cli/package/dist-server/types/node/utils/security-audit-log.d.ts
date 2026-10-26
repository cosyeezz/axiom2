/**
 * 安全审计日志 — agent-cli 层入口
 *
 * agent-cli 将运行时安全事件 append 到 `<HomeDir>/audit-log/spool/*.jsonl`；
 * Desktop Host 在安全中心读取前导入 spool，并补齐正式链上的
 * sequence/prevHash/hash。
 *
 * `<HomeDir>` 由 {@link resolveCliHomeDir} 解析：
 *   定制版 `dataLayout.configDir.userDirName` → `CODEBUDDY_CONFIG_DIR` 环境变量（非空时）→ `~/.codebuddy`。
 * Desktop 在 spawn sidecar 时已显式注入 `CODEBUDDY_CONFIG_DIR=<workbuddy
 * config dir>`，所以 Desktop 端 spool 仍落在 `~/.workbuddy/audit-log/`，
 * 与正式链根目录一致；独立 codebuddy-code CLI 用户则落在 `~/.codebuddy/
 * audit-log/`，与 CLI 其他状态目录约定一致。
 *
 * 写入受 `CODEBUDDY_ENABLE_SECURITY_AUDIT` 环境变量控制：
 *   - WorkBuddy Desktop spawn sidecar 时显式设为 `'1'`，spool 持续写入；
 *     Desktop main 进程定期 drain 到正式审计链。
 *   - 独立 codebuddy-code CLI 用户未显式设置时，所有 append* 函数 no-op，
 *     避免给没有审计 UI / drain 链路的环境留下持续增长的 spool 文件。
 */
export declare function createCommandPreview(command: string): string;
export interface SecurityAuditContext {
    sessionId?: string;
    requestId?: string;
    toolCallId?: string;
}
export interface SecurityAuditEntry extends SecurityAuditContext {
    /** 写入 spool 时生成，导入端据此识别已入库的行。 */
    id?: string;
    category?: string;
    eventType?: string;
    /** i18n key，对齐 `securityCenter.audit.*`。 */
    messageKey?: string;
    /** i18n 插值参数，对应 messageKey 模板中的 `{name}`。 */
    messageParams?: Record<string, string | number>;
    timestamp?: number;
    decision?: 'approved' | 'rejected' | 'blocked' | 'allowed' | 'failed' | 'info';
    commandPreview?: string;
    commandHash?: string;
    metadata?: Record<string, unknown>;
}
export declare function appendToolControlBlockedAuditLog(detail: {
    toolId: string;
    toolName: string;
    serverId?: string;
    reason: 'tool_disabled' | 'mcp_server_disabled' | 'mcp_tool_disabled' | 'custom_mcp_disabled';
} & SecurityAuditContext): void;
export type CommandSafetyAction = 'ask-matched' | 'allow-matched' | 'deny-matched' | 'excluded-command' | 'exec-policy-allow' | 'exec-policy-forbidden' | 'bypass-legacy-silent' | 'session-cache-hit' | 'sensitive-session-cache-hit' | 'pre-exec-bypass-requested' | 'pre-exec-bypass-approved' | 'pre-exec-bypass-rejected' | 'bypass-blocked-by-policy' | 'allow-overridden-by-credential' | 'allow-overridden-by-opaque-host' | 'credential-or-opaque-blocked' | 'safety-filter-ask-override' | 'safety-filter-allow-override' | 'auto-approved' | 'auto-rejected' | 'sandbox-executed' | 'program-blacklist-blocked'
/**
 * 网络严格模式的系统层兜底拦截（genie/genie#122764）。
 *
 * 与 `program-blacklist-blocked` 同型：都是「不可通过审批或 native 重跑修复」
 * 的硬拦截，必须自带独立动作。**不能复用 `sandbox-executed`**——那个的
 * decision 是 `allowed`、文案是「沙箱内执行命令」，与同时落下的
 * `network-strict.blocked`（blocked）在同一条命令上自相矛盾，安全中心按
 * 命令安全筛选时会把已拦截的命令误判为放行。
 */
 | 'network-strict-blocked' | 'approved' | 'rejected' | 'system-tool-blocked' | 'system-tool-confirm-approved' | 'system-tool-confirm-rejected' | 'system-tool-auto-executed' | 'system-tool-session-cache-hit';
export type FileSafetyAction = 'block-listed' | 'deny-matched' | 'allow-listed' | 'ask-matched' | 'session-cache-hit' | 'auto-approved' | 'auto-rejected' | 'needs-approval' | 'approved' | 'rejected';
export type BulkDeleteAuditAction = 'needs-approval' | 'approved' | 'rejected';
export type SensitiveProtectionAuditAction = 'detected' | 'approval-resolved' | 'approval-timeout' | 'protection-applied' | 'original-reused' | 'protection-reused' | 'failure';
export interface SensitiveProtectionAuditDetail extends SecurityAuditContext {
    behavior?: 'fail-open' | 'fail-close';
    choice?: 'allow-original' | 'allow-and-protect' | 'allow-execution' | 'deny';
    detectionRef?: string;
    direction?: 'ingress' | 'egress';
    entryCount?: number;
    itemCount?: number;
    plaintexts?: readonly string[];
    reasonCode?: string;
    ruleCount?: number;
    source?: string;
    stage?: 'detection' | 'approval' | 'protection';
}
interface SecurityAuditLog {
    entries: SecurityAuditEntry[];
}
export interface SandboxBlockAuditLogEvent extends SecurityAuditContext {
    blockType: 'network';
    target: string;
    /** 是否命中恶意网站库。安全中心据此使用面向用户的网络安全文案。 */
    malicious?: boolean;
    /** 面向用户的风险类型，例如“黑灰产 / 钓鱼网站”；不包含 DB 等实现信息。 */
    riskType?: string;
    /**
     * 本次拦截是否来自**网络严格模式**的系统层兜底（genie/genie#122764）。
     *
     * 与 `malicious` 正交：恶意命中是「域名在黑名单里」，严格模式是「程序绕过了代理，
     * 被系统层直接拒绝」——后者与具体域名/规则无关。安全中心据此用「严格模式」文案
     * 而非「域名被拦」文案，让用户看到真实成因，不去找一条并不存在的规则。
     */
    networkStrict?: boolean;
}
export type NetworkAccessAuditOutcome = 'success' | 'allow-matched' | 'ask-matched' | 'approved' | 'auto-approved' | 'auto-rejected' | 'session-cache-hit' | 'blocked' | 'rejected' | 'failed';
export declare function appendSecurityAuditEntry(entry: SecurityAuditEntry): void;
export declare function appendCommandSafetyAuditLog(action: CommandSafetyAction, detail: {
    command?: string;
    matchedRule?: string;
    reason?: string;
    programs?: string;
} & SecurityAuditContext): void;
/**
 * 文件操作类型，用于审计日志按 DELETE/WRITE/READ 分文案。
 *
 * 来源：sandbox 上报的 `actionMask` 位掩码（READ=0x01 / WRITE=0x02 /
 * DELETE=0x04 / EXECUTE=0x08）。优先级：DELETE > WRITE > READ；其它情况
 * （仅 EXECUTE 或 0）回退到 `access`，沿用旧文案。
 */
export type FileSafetyOperation = 'read' | 'write' | 'delete' | 'access';
export declare function fileSafetyOperationFromActionMask(actionMask: number | undefined): FileSafetyOperation;
export declare function appendFileSafetyAuditLog(action: FileSafetyAction, detail: {
    paths: string[];
    matchedRule?: string;
    operation?: FileSafetyOperation;
} & SecurityAuditContext): void;
export declare function appendBulkDeleteAuditLog(action: BulkDeleteAuditAction, detail: {
    command?: string;
    count?: number;
    threshold?: number;
    targets?: string[];
} & SecurityAuditContext): void;
export declare function appendSensitiveProtectionAuditLog(action: SensitiveProtectionAuditAction, detail: SensitiveProtectionAuditDetail): void;
export declare function appendNetworkAccessAuditLog(target: string, outcome: boolean | NetworkAccessAuditOutcome, detail?: {
    reason?: string;
    matchedRule?: string;
    malicious?: boolean;
    riskType?: string;
    /** 结构化上下文（如 MCP server 名与 transport），原样落进审计条目，不进文案。 */
    metadata?: Record<string, unknown>;
} & SecurityAuditContext): void;
export declare function appendSandboxBlockAuditLog(event: SandboxBlockAuditLogEvent): void;
/**
 * 测试辅助：直接读取当前磁盘上的审计日志快照。生产代码不应使用。
 */
export declare function readSecurityAuditLogForTest(): SecurityAuditLog;
export {};
