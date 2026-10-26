import { Logger } from '@celljs/core';
import { type FilePolicyRule } from '@genie/sandbox-cli/file-policy';
import { type SandboxRuleProfile, type SandboxRuleSyncConfig, SandboxRuleSyncEngine, type SandboxRuleSyncResult, type SandboxRuleSyncScope, type SandboxRuleSyncService as SharedSandboxRuleSyncService } from '@genie/sandbox-cli/sandbox-rule-sync-service';
import { type BashSandboxManager as IBashSandboxManager } from '../bash-sandbox/bash-sandbox-protocol';
import { type SandboxCenterIpcClient as ISandboxCenterIpcClient } from '../sensitive-content/sandbox-center-ipc-client-protocol';
import { type ISandboxCLILifecycle } from './sandbox-cli-lifecycle-protocol';
import { type SandboxTurnConfig as ISandboxTurnConfig } from './sandbox-turn-config';
export { FileDirectoryApprovalError, type SandboxRuleSyncResult, type SandboxRuleSyncStatus, type SandboxFileDirectoryApprovalRequest } from '@genie/sandbox-cli/sandbox-rule-sync-service';
export { isWindowsAllowWriteNoBackupPath } from '../bash-sandbox/backup-policy';
export declare const SandboxRuleSyncService: unique symbol;
export type SandboxRuleSyncService = SharedSandboxRuleSyncService<string>;
export declare class SandboxRuleSyncServiceImpl extends SandboxRuleSyncEngine<string> {
    protected readonly httpInterceptDefaults: import("@genie/sandbox-cli/http-policy").HttpInterceptPolicyConfig;
    protected readonly logger: Logger;
    protected readonly bashSandboxManager?: IBashSandboxManager;
    protected readonly turnConfig: ISandboxTurnConfig;
    protected readonly lifecycle?: ISandboxCLILifecycle;
    protected readonly sandboxCenterClient?: ISandboxCenterIpcClient;
    protected readRuleConfiguration(): Promise<SandboxRuleSyncConfig | undefined>;
    protected getRuleContext(): string | undefined;
    /** The query Product of each session's last applied sync; reconnect and release run outside any query. */
    private readonly lastQueryProducts;
    syncRulesOnTurnStart(sessionId: string, context?: string, scope?: SandboxRuleSyncScope): Promise<SandboxRuleSyncResult>;
    syncRulesOnConfigRefresh(sessionId: string, context?: string, scope?: SandboxRuleSyncScope): Promise<SandboxRuleSyncResult>;
    clearSessionAllowHttpHosts(sessionId: string): Promise<void>;
    /** Runs outside-query work as the session's last query: the managed policy follows its Product. */
    protected runSessionMaintenance<T>(sessionId: string, run: () => T): T;
    private recordQueryProduct;
    /**
     * Turn start and configuration refresh ask the shell environment policy once,
     * for the run's root session, and keep the managed runtime directories it
     * names in the session's scope. Without an answer the scope keeps the
     * directories it has; a new scope then reads this process's environment.
     */
    private withManagedRuntimeDirectories;
    private captureScope;
    protected getConfigDir(): string;
    protected getProjectHomeDir(): string;
    protected getWorkspacePath(): string;
    protected isWorkBuddyDesktop(): boolean;
    protected resolveRuleProfile(permissionMode?: string): SandboxRuleProfile;
    protected getBrokeredShellRuntimeReadOnlyPaths(): string[];
    private buildProductProtectedRules;
    protected buildBaseFileRules(config: SandboxRuleSyncConfig, ruleProfile: SandboxRuleProfile, scope?: SandboxRuleSyncScope): FilePolicyRule[];
    private normalizeMacOSUnlinkPolicy;
    private buildFullAccessFileRules;
    /**
     * Linux：放行沙箱内读取/执行托管 Node/Python 运行时目录。
     *
     * Linux 上托管 node/python 以「包内受信目录 + 软链」交付：
     * `~/.workbuddy/binaries/<runtime>/versions/<v>/bin` 是指向包内
     * `/opt/<App>/resources/runtime/<runtime>/bin` 的软链。沙箱内核会按真实路径裁决，
     * 故同时下发软链路径与其 realpath（/opt 目标），确保 agent 能在沙箱里 spawn 运行时。
     *
     * 目录取自 `CODEBUDDY_SHELL_PREPEND_PATH`。宿主按托管运行时开关给出这组目录，
     * 这里不再按开关二次过滤。
     */
    private getLinuxManagedRuntimeReadOnlyRules;
}
