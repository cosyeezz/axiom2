import { type InterruptionService as InterruptionServiceInterface, type SessionManager as SessionManagerInterface } from '../../vendor/cbc-core/node/index.js';
import { type SensitiveApprovalChoice, type SensitiveApprovalPort as SensitiveApprovalPortInterface } from './sensitive-content-protocol';
type SensitiveApprovalRequest = Parameters<SensitiveApprovalPortInterface['requestApproval']>[0];
export declare class SensitiveApprovalPortImpl implements SensitiveApprovalPortInterface {
    protected readonly sessionManager?: SessionManagerInterface;
    protected readonly interruptionService?: InterruptionServiceInterface;
    requestApproval(request: SensitiveApprovalRequest): Promise<SensitiveApprovalChoice>;
    registerAutomaticProtectionGrant(request: {
        sessionId: string;
        grantKey: string;
        signal?: AbortSignal;
    }): Promise<void>;
    private requestApprovalTransport;
    /**
     * 宿主经 canUseTool 回答（进程内没有 ACP 连接，队列无人读取）。卡片与超时同 ACP，
     * 本轮取消或超时时撤回卡片；「允许并保护」是卡片的会话级允许。
     */
    private requestHostApproval;
    private getApprovalTimeoutMs;
    private resolveActiveSession;
    private getSessionManager;
    private getInterruptionService;
    private buildApprovalItem;
    /** 卡片内容，ACP 审批项与宿主 canUseTool 共用。 */
    private describeApproval;
    private mapTransportChoice;
    private isTimeoutAbort;
}
export {};
