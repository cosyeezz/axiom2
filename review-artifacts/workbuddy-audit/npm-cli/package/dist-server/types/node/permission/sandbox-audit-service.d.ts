/**
 * Sandbox Audit Service — fire-and-forget command audit via AgentDR SDK.
 *
 * Observe mode only. Collects command data after sandbox policy handling;
 * does NOT participate in allow/deny decisions. Historical wire field names
 * remain compatible even though the local SafetyFilter has been removed.
 *
 * Configuration priority: process.env > built-in defaults.
 */
export declare const SandboxAuditService: unique symbol;
export interface SandboxAuditParams {
    command: string;
    cwd: string;
    stage: 'post_exec_safety_filter';
    safetyFilterResult?: {
        autoApproveCount: number;
        needsApprovalCount: number;
        riskLevels: string[];
    };
    /** 沙箱首跑回调数据，透传给科恩 SDK context.wb_sandbox.attempt */
    sandboxAttempt?: Record<string, unknown>;
}
export interface SandboxAuditService {
    /**
     * Fire-and-forget audit. Never throws, never blocks the caller.
     */
    auditCommand(params: SandboxAuditParams): Promise<void>;
}
export declare class SandboxAuditServiceImpl implements SandboxAuditService {
    private readonly clientInfoProvider?;
    private readonly sessionManager;
    private readonly logger;
    private initPromise;
    auditCommand(params: SandboxAuditParams): Promise<void>;
    private _initSdk;
    private _getDeviceId;
    private _buildWbSandboxContext;
    private _getWorkbuddyDesktopVersion;
    private _normalizeVersion;
}
