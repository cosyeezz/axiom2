import { InterruptionService } from '../../vendor/cbc-core/node/index.js';
import { type RuntimeSecurityApprovalOutcome, type RuntimeSecurityApprovalRequest, RuntimeSecurityApprovalService } from './runtime-security-protocol';
export declare class RuntimeSecurityApprovalServiceImpl implements RuntimeSecurityApprovalService {
    protected readonly interruptionService: InterruptionService;
    requestApproval(request: RuntimeSecurityApprovalRequest): Promise<RuntimeSecurityApprovalOutcome>;
    /**
     * 宿主经 canUseTool 回答（进程内没有 ACP 连接，队列无人读取）。同 ACP：明确拒绝
     * 记为用户拒绝，取消或无法询问按默认处理。
     */
    private requestHostApproval;
}
