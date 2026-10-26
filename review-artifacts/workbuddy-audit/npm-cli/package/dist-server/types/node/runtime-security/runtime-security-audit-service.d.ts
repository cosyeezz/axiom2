import { AuthenticationManager } from '@genie/authentication';
import { SessionStore } from '../../vendor/cbc-core/node/index.js';
import { ClientInfoProvider, ProductManager, type RemoteRuntimeSecurity, type RuntimeSecurityScene } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { type HookExecutionResult, type HookInput } from '../hooks/hook-protocol';
import { type SecurityAuditEntry } from '../utils/security-audit-log';
import { RuntimeAuditClient } from './runtime-audit-client';
import { RuntimeSecurityApprovalService, RuntimeSecurityAuditService } from './runtime-security-protocol';
type ClientFactory = (options: {
    endpoint: string;
    accessToken: string;
}) => Pick<RuntimeAuditClient, 'postRuntimeAudit'>;
export declare class RuntimeSecurityAuditServiceImpl implements RuntimeSecurityAuditService {
    protected readonly productManager: ProductManager;
    protected readonly authenticationManager: AuthenticationManager;
    protected readonly clientInfoProvider?: ClientInfoProvider;
    protected readonly logger: Logger;
    protected readonly approvalService: RuntimeSecurityApprovalService;
    protected readonly sessionStore?: SessionStore;
    protected clientFactory: ClientFactory;
    protected appendAudit: (entry: SecurityAuditEntry) => void;
    private clientKey;
    private client;
    private readonly toolAudits;
    audit(scene: RuntimeSecurityScene, input: HookInput, policy: RemoteRuntimeSecurity): Promise<HookExecutionResult | undefined>;
    private runAudit;
    private appendRuntimeAudit;
    private resolveDeviceId;
    private getClient;
    private authenticationRequired;
    private recordDegradedAudit;
    private openResult;
    private toHookResult;
    private emitPresentation;
}
export {};
