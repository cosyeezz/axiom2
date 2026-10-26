import { Logger } from '@celljs/core';
import { type SandboxExecPolicy as ISandboxExecPolicy } from '../permission/sandbox-exec-policy-protocol';
import { type SensitiveCommandDetector as ISensitiveCommandDetector } from '../permission/sensitive-command-detector';
import { SandboxTurnConfig } from '../sandbox-cli/sandbox-turn-config';
import { type SettingsManager as ISettingsManager } from '../settings/settings-protocol';
import { BashSandboxManager as IBashSandboxManager, SandboxConfig, SandboxDependencyError } from './bash-sandbox-protocol';
export { expandWindowsNativeDirectoryGlobs } from '@genie/sandbox-cli/sandbox-filesystem-policy';
/**
 * Bash 沙箱管理器实现
 * 负责沙箱配置解析；命令执行由 sandbox-cli 承担
 */
export declare class BashSandboxManagerImpl implements IBashSandboxManager {
    protected readonly settingsManager: ISettingsManager;
    protected readonly logger: Logger;
    /**
     * Optional so that environments that boot the sandbox manager without the
     * policy module registered (e.g. legacy headless paths) keep working;
     * when present we forward `settings.sandbox.execPolicy` updates on each
     * config load so the policy's user rules stay in sync with settings.
     */
    protected readonly execPolicy?: ISandboxExecPolicy;
    protected readonly sensitiveCommandDetector?: ISensitiveCommandDetector;
    protected readonly sandboxTurnConfig: SandboxTurnConfig;
    /** Last user-rules payload we pushed into the ExecPolicy; used to avoid
     *  redundant `setUserRules` calls when settings are unchanged. */
    private lastExecPolicyUserRulesKey;
    private lastOrderedCommandRulesKey;
    /**
     * 获取当前沙箱配置
     */
    getConfig(): Promise<SandboxConfig | undefined>;
    /**
     * 检查命令是否应该在沙箱中执行
     */
    shouldSandbox(command: string): Promise<boolean>;
    /**
     * 检查命令是否属于系统级工具（如 WSL）。
     * 复用 sandbox-cli 的命令根解析器提取命令根。
     */
    isSystemLevelTool(command: string): boolean;
    /**
     * 检查 Linux 平台沙箱所需的依赖
     * @returns 缺失的依赖列表
     */
    private checkLinuxDependencies;
    /**
     * 检查 Linux 依赖并返回错误（如果有缺失）
     * 供外部调用（如 /sandbox 命令）显示给用户
     */
    checkDependencies(): Promise<SandboxDependencyError | undefined>;
    /**
     * 从设置中加载沙箱配置
     */
    private loadConfig;
    /**
     * 扩展路径中的波浪号
     */
    private expandPaths;
    /**
     * Push user-authored ExecPolicy rules into the policy component.
     *
     * `undefined` fingerprint means "no execPolicy set" — we also forward
     * `undefined` so the policy clears any previously loaded user rules
     * (important when a user removes the settings block entirely).
     */
    private syncExecPolicyUserRules;
    private syncOrderedCommandRules;
}
