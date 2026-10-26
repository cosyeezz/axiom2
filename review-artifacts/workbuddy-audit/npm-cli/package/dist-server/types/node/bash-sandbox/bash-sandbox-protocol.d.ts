import type { FileBackupConfig } from '@genie/sandbox-cli/backup-policy';
import type { FilePolicyRule } from '@genie/sandbox-cli/file-policy';
import type { HttpInterceptPolicyConfig } from '@genie/sandbox-cli/http-policy';
import { type SystemToolPolicy } from '@genie/sandbox-cli/program-policy';
import type { SecurityCenterOrderedRulesConfig } from '@genie/sandbox-cli/rule-config';
import type { SandboxExecPolicyUserRules as SandboxExecPolicyUserConfig } from '@genie/sandbox-cli/sandbox-exec-policy';
export * from '@genie/sandbox-cli/rule-config';
export { type FileBackupConfig, FILE_BACKUP_DEFAULT_MAX_SIZE_MB, FILE_BACKUP_MIN_SIZE_MB, FILE_BACKUP_MAX_SIZE_MB, parseFileBackupMaxSizeMB, normalizeFileBackupMaxSizeMB } from '@genie/sandbox-cli/backup-policy';
export * from './backup-policy';
export { DEFAULT_HTTP_INTERCEPT_CONFIG, type HttpInterceptPolicy, type HttpInterceptPolicyConfig } from '@genie/sandbox-cli/http-policy';
export { DEFAULT_TOOLCHAIN_ALLOW_WRITE_DIRS, WINDOWS_DEFAULT_ALLOW_WRITE_DIRS, WINDOWS_RECYCLE_BIN_ALLOW_WRITE_PATH } from '@genie/sandbox-cli/presets/file-policy-paths';
export { DEFAULT_WINDOWS_PROGRAM_BLACKLIST, SYSTEM_LEVEL_TOOLS, type SystemToolPolicy } from '@genie/sandbox-cli/program-policy';
/**
 * 用户在 settings.sandbox.execPolicy 下声明的规则配置。
 *
 * 规则形状由 sandbox-cli 的匹配算法持有，这里只保留 Agent 侧的历史命名：
 * `SandboxExecPolicyUserConfig` 对应包内的 `SandboxExecPolicyUserRules`。
 */
export type { SandboxExecPolicyRuleConfig } from '@genie/sandbox-cli/sandbox-exec-policy';
export type { SandboxExecPolicyUserConfig };
export declare function resolveProgramBlacklistForPlatform(configuredPrograms: readonly string[] | undefined, legacyPolicy: SystemToolPolicy | undefined, platform?: NodeJS.Platform): string[] | undefined;
/** `settings.sandbox` 中沿用的历史字段形状，保持已有用户配置可解析。 */
export interface SandboxRuntimeConfig {
    network: {
        allowedDomains: string[];
        deniedDomains: string[];
        allowUnixSockets?: string[];
        allowAllUnixSockets?: boolean;
        allowLocalBinding?: boolean;
        httpProxyPort?: number;
        socksProxyPort?: number;
    };
    filesystem: {
        denyRead: string[];
        allowWrite: string[];
        denyWrite: string[];
    };
    ignoreViolations?: Record<string, string[]>;
    enableWeakerNestedSandbox?: boolean;
    ripgrep?: {
        command: string;
        args?: string[];
    };
    mandatoryDenySearchDepth?: number;
}
/**
 * Bash 沙箱配置接口
 * 基于 SandboxRuntimeConfig,添加了额外的 CLI 特定配置
 */
export type MacOSUnlinkPolicy = 'allow' | 'ask' | 'deny';
export interface SandboxConfig {
    /** 是否启用沙箱 */
    enabled?: boolean;
    /** 当命令在沙箱中运行时自动批准 bash 命令 (默认: true) */
    autoAllowBashIfSandboxed?: boolean;
    /** 从沙箱中排除的命令列表(这些命令将在沙箱外执行)；WorkBuddy Desktop 忽略此项 */
    excludedCommands?: string[];
    /** 是否允许使用 dangerouslyDisableSandbox 参数 */
    allowUnsandboxedCommands?: boolean;
    /**
     * 高级拦截（genie/genie#116558，Windows 原生隔离）。
     *
     * 由安全中心面板写入 `settings.sandbox.advancedInterceptionEnabled`，运行时经
     * loadConfig 透传，供 SandboxRuleSyncService 经 `sandbox.rules.set_config`
     * 下发（裸布尔）。center 点亮 Windows 壳 JSON 的 windows_isolation 位，
     * tsbx_sdk 对新建沙箱进程走受限令牌臂。
     *
     * 仅 Windows 有执行面（非 win 平台下发侧跳过）。缺省/缺失 = 关闭。
     */
    advancedInterceptionEnabled?: boolean;
    /** 网络配置 */
    network?: Partial<Omit<SandboxRuntimeConfig['network'], 'allowedDomains' | 'deniedDomains'>> & {
        /** 安全中心恶意域名库拦截开关，产品默认开启。 */
        maliciousDomainProtectionEnabled?: boolean;
        /**
         * HTTP 明文请求拦截三态策略（远程/本地各一态）。
         * 由安全中心面板写入 `settings.sandbox.network.httpIntercept`，
         * 运行时经 loadConfig 的对象 spread 透传，供 SandboxRuleSyncService
         * 翻译成 Center 的 HttpInterceptRule[] 全量下发。
         */
        httpIntercept?: HttpInterceptPolicyConfig;
        /**
         * 网络严格模式（genie/genie#122764）：采用系统机制拦截未被感知的网络请求。
         *
         * 由安全中心面板写入 `settings.sandbox.network.networkStrictMode`，运行时经
         * loadConfig 的对象 spread 透传，供 SandboxRuleSyncService 直接
         * `sandbox.rules.set_config` 下发（裸布尔，无需翻译）。
         *
         * 仅 macOS 有执行面（SBPL `deny_all_network`），非 mac 平台不下发。
         * 缺省/缺失 = 关闭。
         */
        networkStrictMode?: boolean;
    };
    /** 文件系统配置 */
    filesystem?: SandboxRuntimeConfig['filesystem'];
    /** Resolved native file policy (runtime only). Legacy filesystem remains for old backends. */
    fileRules?: FilePolicyRule[];
    /** 忽略违规配置 */
    ignoreViolations?: SandboxRuntimeConfig['ignoreViolations'];
    /** 启用较弱的嵌套沙箱模式 */
    enableWeakerNestedSandbox?: SandboxRuntimeConfig['enableWeakerNestedSandbox'];
    /** Ripgrep 配置 */
    ripgrep?: SandboxRuntimeConfig['ripgrep'];
    /** 强制拒绝路径搜索深度 (Linux only, 默认: 3, 范围: 1-10) */
    mandatoryDenySearchDepth?: SandboxRuntimeConfig['mandatoryDenySearchDepth'];
    /**
     * SandboxExecPolicy 的用户扩展规则。
     * 内置规则（ls/cat 等放行、rm -rf / 等禁止）始终生效，此处仅用于追加/覆盖。
     */
    execPolicy?: SandboxExecPolicyUserConfig;
    /** 安全中心「程序黑名单」配置；命中时由 sandbox-cli 阻止创建/执行程序。 */
    programBlacklist?: string[];
    /** 安全中心新版有序规则，作为规则运行时真源。 */
    orderedRules?: SecurityCenterOrderedRulesConfig;
    /** 安全中心「文件备份」配置。 */
    fileBackup?: FileBackupConfig;
    /**
     * 宿主应用（如 workbuddy-desktop）注入的额外 allowWrite 路径。
     * loadConfig() 会将此列表追加到 filesystem.allowWrite，不影响内置默认值。
     * 用于与 agent-cli 通用配置解耦的产品特有目录（如 ~/.tencent-cloudq）。
     */
    extraAllowWrite?: string[];
    /** @deprecated 仅用于把旧配置迁移到 programBlacklist。 */
    systemToolPolicy?: SystemToolPolicy;
    /** 实验功能：工作空间内文件版本管理 */
    versionControl?: boolean;
    /** macOS 非白名单直接 unlink 的自动兜底动作；历史缺省为 ask。 */
    macosUnlinkPolicy?: MacOSUnlinkPolicy;
    /** 实验功能：工作空间内删除进回收站 */
    deleteProtection?: boolean;
    /** 实验功能：运行时删除回收站保护（Node/Python/Git Bash 注入） */
    safeDeleteRuntimeEnabled?: boolean;
}
/**
 * Linux 沙箱依赖检查错误
 */
export declare class SandboxDependencyError extends Error {
    readonly missingDependencies: string[];
    constructor(message: string, missingDependencies: string[]);
}
/**
 * Bash 沙箱管理器接口
 * 负责管理 Bash 命令沙箱的配置
 */
export interface BashSandboxManager {
    /** 获取当前沙箱配置 */
    getConfig(): Promise<SandboxConfig | undefined>;
    /** 检查命令是否应该在沙箱中执行 */
    shouldSandbox(command: string): Promise<boolean>;
    /** 检查 Linux 依赖，返回错误（如果有缺失） */
    checkDependencies(): Promise<SandboxDependencyError | undefined>;
    /** 检查命令是否属于系统级工具（如 WSL）。 */
    isSystemLevelTool(command: string): boolean;
}
export declare const BashSandboxManager: unique symbol;
/**
 * 沙箱违规事件
 */
export interface SandboxViolation {
    /** 违规类型 */
    type: 'network' | 'filesystem';
    /** 违规操作 */
    operation: string;
    /** 目标资源 */
    target: string;
    /** 违规命令 */
    command?: string;
    /** 时间戳 */
    timestamp: number;
}
export declare function getDefaultSandboxAllowWritePath(): string;
export declare function isSafeDeleteRuntimeEnabledInSandboxConfig(sandboxConfig: Pick<SandboxConfig, 'safeDeleteRuntimeEnabled'> | undefined): boolean;
export declare function shouldIncludeDefaultSandboxAllowWritePath(sandboxConfig: Pick<SandboxConfig, 'safeDeleteRuntimeEnabled'> | undefined, platform?: NodeJS.Platform): boolean;
export declare function getDefaultSandboxFilesystemConfig(sandboxConfig: Pick<SandboxConfig, 'safeDeleteRuntimeEnabled'> | undefined, platform?: NodeJS.Platform): NonNullable<SandboxRuntimeConfig['filesystem']>;
export declare const DEFAULT_SANDBOX_CONFIG: SandboxConfig;
/**
 * 沙箱设置 key
 */
export declare const SANDBOX_SETTING_KEY = "sandbox";
