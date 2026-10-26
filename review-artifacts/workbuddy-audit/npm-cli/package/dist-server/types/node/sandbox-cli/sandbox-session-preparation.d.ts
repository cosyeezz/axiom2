import { normalizeFileBackupMaxSizeMB, normalizeModifyBackupThresholdMB } from '@genie/sandbox-cli/backup-policy';
import type { Logger } from '@genie/telemetry';
import type { SandboxCenterIpcClient } from '../sensitive-content/sandbox-center-ipc-client-protocol';
import { type Settings, SettingsManager } from '../settings';
import type { ISandboxCLILifecycle } from './sandbox-cli-lifecycle-protocol';
import type { SandboxCLIProcessManager } from './sandbox-cli-protocol';
import type { SandboxTurnConfig } from './sandbox-turn-config';
export declare function isFileBackupSupported(): boolean;
export declare function shouldUseSandboxCLI(settingsEnabled: boolean): boolean;
export { normalizeFileBackupMaxSizeMB, normalizeModifyBackupThresholdMB };
interface ResolvedSandboxSessionSettings {
    configuredSandboxEnabled: boolean;
    useSandboxCLI: boolean;
    fileBackupEnabled: boolean;
    fileBackupMaxSizeMB?: number;
    modifyBackupThresholdMB?: number;
}
/**
 * 普通对话通过隔离执行策略校验后，与冷回退共用这份设置解析。
 *
 * 企业托管覆盖就落在这里（issue #129503）：这是两条入口唯一共用的解析点。
 * 之前只在 `sandbox-interceptor` 叠加托管值，冷回退（`loadSandboxSessionSettings`
 * → 文件回退的 `ensureSandboxReady`）直解原始 settings，于是「企业开启 + 本地
 * settings 关闭」时普通对话启用沙箱、冷回退却判为关闭并返回 SANDBOX_UNAVAILABLE，
 * 历史消息回退恢复不了文件。该矛盾状态是可构造的：ACP 配置入口仍允许写入与企业值
 * 相反的 settings。
 *
 * 两个方向都在此收敛，顺序即优先级：
 * - 托管**关闭** → 一律按关处理（含文件备份），settings 说开也不认；
 * - 托管**开启** → 先把 `sandbox.enabled` 叠成 true 再按常规解析，让 useSandboxCLI /
 *   文件备份 / maxSizeMB 全部按「沙箱已启用」一次算出（逐字段打补丁会漏掉文件备份，
 *   因为它依赖 useSandboxCLI）。
 *
 * 强制开仍受**平台能力**约束：下面的 `shouldUseSandboxCLI` 保留平台判定，不支持的
 * 平台上不会置 true，否则下游会等一个永不就绪的沙箱。
 */
export declare function resolveSandboxSessionSettings(mergedSettings: Settings, logger: Logger): ResolvedSandboxSessionSettings;
/** 无用户消息的文件回退独立读取会话设置；正常对话仍先校验隔离执行策略。 */
export declare function loadSandboxSessionSettings(settingsManager: SettingsManager, turnConfig: SandboxTurnConfig, logger: Logger, policyPermissionMode?: string): Promise<{
    configuredSandboxEnabled: boolean;
    settingsReadFailed: boolean;
}>;
/** 备份开关与常规对话共用同一份配置；5.7.0 的回退边界使用完整 file rules 视图。 */
export declare function syncModifyBackupConfig(sessionId: string, deps: {
    turnConfig: SandboxTurnConfig;
    lifecycle?: ISandboxCLILifecycle;
    centerClient?: SandboxCenterIpcClient;
    processManager?: SandboxCLIProcessManager;
    logger: Logger;
    /** 用于推导 Gradle 输出目录的工作区根；缺省取当前工作目录。 */
    workspaceRoots?: readonly string[];
}): Promise<void>;
