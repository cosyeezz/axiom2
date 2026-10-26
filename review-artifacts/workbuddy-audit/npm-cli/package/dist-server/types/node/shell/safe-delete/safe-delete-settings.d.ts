/**
 * safe-delete 运行时开关读取与注入日志——消除 ShellService / SandboxShellService /
 * PowerShellTool 三处重复。
 */
import { type SafeDeleteRuntimeConfig } from '@genie/sandbox-cli/safe-delete-bulk-guard';
export type { SafeDeleteRuntimeConfig } from '@genie/sandbox-cli/safe-delete-bulk-guard';
export { MAX_SAFE_DELETE_BULK_THRESHOLD, MIN_SAFE_DELETE_BULK_THRESHOLD, parseSafeDeleteBulkThreshold, } from '@genie/sandbox-cli/safe-delete-bulk-guard';
export interface SafeDeleteSettingsReader {
    list(): Promise<{
        sandbox?: {
            safeDeleteBulkThreshold?: number;
            safeDeleteRuntimeEnabled?: boolean;
        };
    }>;
}
export interface SafeDeleteLogger {
    info?(...args: unknown[]): void;
    warn?(...args: unknown[]): void;
}
/**
 * 从 SettingsManager 读取 sandbox.safeDeleteRuntimeEnabled，读取失败默认 true。
 */
export declare function resolveSafeDeleteRuntimeEnabled(settingsManager: SafeDeleteSettingsReader, logger: SafeDeleteLogger | undefined, source: string): Promise<boolean>;
/**
 * 从 SettingsManager 读取 sandbox.safeDeleteRuntimeEnabled 和 safeDeleteBulkThreshold。
 * 读取失败默认启用 runtime safe-delete，批量删除阈值使用默认常量。
 */
export declare function resolveSafeDeleteRuntimeConfig(settingsManager: SafeDeleteSettingsReader, logger: SafeDeleteLogger | undefined, source: string): Promise<SafeDeleteRuntimeConfig>;
/**
 * 记录 safe-delete 环境变量注入日志——统一格式。
 */
export declare function logSafeDeleteInjection(logger: SafeDeleteLogger | undefined, source: string, env: Record<string, string | undefined>, safeDeleteRuntimeEnabled: boolean): void;
