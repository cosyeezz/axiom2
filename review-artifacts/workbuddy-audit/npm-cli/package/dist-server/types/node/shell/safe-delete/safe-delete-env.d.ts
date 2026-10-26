import { injectSafeDeleteEnv as injectRuntimeSafeDeleteEnv, type SafeDeleteEnvBuildOptions as RuntimeOptions } from '@genie/sandbox-cli/safe-delete-env';
import type { SafeDeleteRuntimeConfig } from './safe-delete-settings';
export type SafeDeleteEnvBuildOptions = Omit<RuntimeOptions, 'defaultBulkThreshold'>;
export declare function injectSafeDeleteEnv(env: Parameters<typeof injectRuntimeSafeDeleteEnv>[0], runtimePaths: Parameters<typeof injectRuntimeSafeDeleteEnv>[1], options?: SafeDeleteEnvBuildOptions): void;
export declare function buildSafeDeleteEnv(baseEnv?: Record<string, string>, options?: SafeDeleteEnvBuildOptions): Record<string, string>;
export declare function buildPowerShellSafeDeleteEnv(sessionManager: {
    sessionSubject: {
        value: {
            id?: string;
            conversationRequestId?: string;
        } | null | undefined;
    };
}, safeDeleteRuntimeConfig: SafeDeleteRuntimeConfig, options?: {
    toolCallId?: string;
    bulkThreshold?: number;
    session?: {
        id?: string;
        conversationRequestId?: string;
    };
}): Record<string, string>;
