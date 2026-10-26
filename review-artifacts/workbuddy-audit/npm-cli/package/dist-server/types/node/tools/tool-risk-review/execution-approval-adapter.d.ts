import { type InterruptionService as InterruptionServiceInterface } from '../../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { type ExecutionApprovalAdapter as ExecutionApprovalAdapterInterface, type ExecutionApprovalRequest, type ExecutionApprovalResult } from './protocol';
export { TOOL_RISK_EXECUTION_APPROVAL_PROVIDER_KEY } from './permission-metadata';
export declare class ExecutionApprovalAdapterImpl implements ExecutionApprovalAdapterInterface {
    protected readonly interruptionService?: InterruptionServiceInterface;
    protected readonly logger?: Logger;
    requestApproval(input: ExecutionApprovalRequest): Promise<ExecutionApprovalResult>;
    private buildApprovalItem;
    private isBindingValid;
}
