import { Logger } from '@celljs/core';
import type { SandboxRuleContext } from '@genie/agent-client-protocol';
import { type InterruptionService as IInterruptionService, type Session } from '../../vendor/cbc-core/node/index.js';
import { type FunctionCallItem } from '../../vendor/cbc-shared/node/index.js';
import { type AcpAgentManager as IAcpAgentManager, type AcpBroadcastService as IAcpBroadcastService } from '../acp/acp-protocol';
import { type ISandboxCLILifecycle } from '../sandbox-cli/sandbox-cli-lifecycle-protocol';
import { type SandboxRuleSyncService as ISandboxRuleSyncService } from '../sandbox-cli/sandbox-rule-sync-service';
import { type SandboxTurnConfig as ISandboxTurnConfig } from '../sandbox-cli/sandbox-turn-config';
import { type SecurityReviewGate as SecurityReviewGateContract } from '../security-review/protocol';
import { type SandboxCenterIpcClient as ISandboxCenterIpcClient } from '../sensitive-content/sandbox-center-ipc-client-protocol';
export declare const SandboxWriteRuleGuard: unique symbol;
export interface SandboxWriteRuleEffect {
    targetPath: string;
    existedBefore: boolean;
    beforeExecute(): Promise<void>;
    afterSuccess(): Promise<void>;
}
export interface SandboxWriteRuleGuard {
    /**
     * 对调用方已解析好的目标做完整的网络规则裁决：问 Center、记 allow/ask/deny 审计、
     * deny 抛错、ask 走审批卡片（带命中规则，卡片的「查看拦截规则」能定位到它）。
     * 不含 `useSandboxCLI` 门控——是否受沙箱管控由调用方判定。
     */
    ensureNetworkTargetsAllowed(toolName: string, targets: readonly SandboxNetworkTarget[], session: Session | undefined, details?: {
        toolCall: FunctionCallItem;
    }, auditMetadata?: Record<string, unknown>): Promise<void>;
    ensureNetworkAllowed(toolName: string, toolInput: Record<string, any> | undefined, session: Session, details?: {
        toolCall: FunctionCallItem;
    }): Promise<void>;
    ensureReadAllowed(toolName: string, toolInput: Record<string, any> | undefined, session: Session, details?: {
        toolCall: FunctionCallItem;
    }): Promise<void>;
    ensureAllowed(toolName: string, toolInput: Record<string, any> | undefined, session: Session, details?: {
        toolCall: FunctionCallItem;
    }): Promise<void>;
    prepareWrite(toolName: string, toolInput: Record<string, any> | undefined, session: Session, details?: {
        toolCall: FunctionCallItem;
    }): Promise<SandboxWriteRuleEffect | undefined>;
    /** Rollback snapshot without an approval prompt; new files are accepted only where writes are already allowed. */
    prepareBackup(filePath: string, session: Session): Promise<SandboxWriteRuleEffect | undefined>;
}
type NetworkRuleAction = 'allow' | 'ask' | 'deny';
interface NetworkRuleDecision {
    ruleContext?: SandboxRuleContext;
    host: string;
    port?: number;
    scheme?: string;
    action: NetworkRuleAction;
    reason?: string;
    matchedRule?: string;
}
export interface SandboxNetworkTarget {
    host: string;
    port?: number;
    scheme?: string;
}
export declare class SandboxWriteRuleGuardImpl implements SandboxWriteRuleGuard {
    protected readonly turnConfig: ISandboxTurnConfig;
    protected readonly lifecycle: ISandboxCLILifecycle;
    protected readonly sandboxCenterClient?: ISandboxCenterIpcClient;
    protected readonly sandboxRuleSyncService?: ISandboxRuleSyncService;
    protected readonly logger: Logger;
    protected readonly interruptionService?: IInterruptionService;
    protected readonly securityReviewGate?: SecurityReviewGateContract;
    protected readonly acpAgentManager?: IAcpAgentManager;
    protected readonly acpBroadcastService?: IAcpBroadcastService;
    ensureNetworkAllowed(toolName: string, toolInput: Record<string, any> | undefined, session: Session, details?: {
        toolCall: FunctionCallItem;
    }): Promise<void>;
    ensureNetworkTargetsAllowed(toolName: string, targets: readonly SandboxNetworkTarget[], session: Session | undefined, details?: {
        toolCall: FunctionCallItem;
    }, auditMetadata?: Record<string, unknown>): Promise<void>;
    ensureNetworkApproval(toolName: string, decision: NetworkRuleDecision, session: Session, details?: {
        toolCall: FunctionCallItem;
    }, auditMetadata?: Record<string, unknown>): Promise<void>;
    private networkApprovalKey;
    private getNetworkHosts;
    private getNetworkRuleDecision;
    ensureReadAllowed(toolName: string, toolInput: Record<string, any> | undefined, session: Session, details?: {
        toolCall: FunctionCallItem;
    }): Promise<void>;
    ensureAllowed(toolName: string, toolInput: Record<string, any> | undefined, session: Session, details?: {
        toolCall: FunctionCallItem;
    }): Promise<void>;
    prepareWrite(toolName: string, toolInput: Record<string, any> | undefined, session: Session, details?: {
        toolCall: FunctionCallItem;
    }): Promise<SandboxWriteRuleEffect | undefined>;
    prepareBackup(filePath: string, session: Session): Promise<SandboxWriteRuleEffect | undefined>;
    private ensureWriteAskApproved;
    private revalidateAppearedWrite;
    private createEffect;
    private isFileBackupEnabled;
    private shouldModifyBackupBeforeWrite;
    private shouldRegisterCreatedFileForRollback;
    private maybeModifyBackupBeforeWrite;
    private isModifyBackupExcludedPath;
    private isModifyBackupExcludedFile;
    private getModifyBackupExcludedPathOptions;
    private isModifyBackupSupportedPlatform;
    private supportsAutoGrantRuleEffect;
    private getPlatform;
    private modifyBackup;
    private rememberSessionFileApproval;
    private addAutoGrantRuleForCreatedPath;
    private statPath;
    private matchRuntimeRuleOrDeny;
    private matchRuntimeRule;
    private getRuntimeMatchTimeoutMs;
    private getApprovalTimeoutMs;
    private isBlockingRule;
    private getOperationAction;
    private getTargetPath;
    private appendFileApprovalAudit;
    private shouldRecordAllowAudit;
    private getMatchedRule;
    private getToolCallId;
    private normalizeTargetPath;
    private getDirectoryApprovalContext;
    private requestApproval;
    private handleApprovalTimeout;
    private findMainSessionSafe;
    private getAcpAgentForSession;
    private buildSyntheticApprovalItem;
    private buildApprovalMetadata;
    private ensureStableToolCallId;
}
export {};
