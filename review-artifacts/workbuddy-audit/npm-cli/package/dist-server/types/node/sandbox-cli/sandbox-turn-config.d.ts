export declare const SandboxTurnConfig: unique symbol;
export interface SandboxTurnConfig {
    useSandboxCLI: boolean;
    /** 文件备份：是否启用 */
    enableFileBackup: boolean;
    /** Successful native enable acknowledgment for this Turn; not merely the requested switch. */
    modifyBackupConfirmed?: boolean;
    /** 文件备份：总大小上限（MB） */
    fileBackupMaxSizeMB?: number;
    /** 文件备份：单文件备份阈值（MB） */
    modifyBackupThresholdMB?: number;
    /** safe-delete 运行时保护是否启用（来自 sandbox config） */
    safeDeleteRuntimeEnabled: boolean;
    /** 当前 filesystem.allowWrite 是否已包含 allow-all 路径 */
    configAllowsAllWritePath: boolean;
    /** 当前 session 权限模式，用于决定沙箱规则宽严。 */
    permissionMode?: string;
    /** 本轮最终沙箱规则 profile。 */
    ruleProfile?: 'sandbox-disabled' | 'default-strict' | 'fullAccess-relaxed';
}
export declare class SandboxTurnConfigImpl implements SandboxTurnConfig {
    useSandboxCLI: boolean;
    enableFileBackup: boolean;
    modifyBackupConfirmed: boolean;
    fileBackupMaxSizeMB?: number;
    modifyBackupThresholdMB?: number;
    safeDeleteRuntimeEnabled: boolean;
    configAllowsAllWritePath: boolean;
    permissionMode?: string;
    ruleProfile?: 'sandbox-disabled' | 'default-strict' | 'fullAccess-relaxed';
}
