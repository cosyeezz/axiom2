import type { RuntimeSecurityCategory, RuntimeSecurityScene } from '@genie/product';
export interface RuntimeAuditMetadata {
    sessionId: string;
    requestId?: string;
    agentId?: string;
    clientVersion?: string;
    clientType?: string;
    deviceId?: string;
}
export interface RuntimeAuditResolvedFile {
    path: string;
    content: string;
    encoding?: string;
}
export interface RuntimeAuditRequest {
    scene: RuntimeSecurityScene;
    metadata: RuntimeAuditMetadata;
    history: {
        events: unknown[];
    };
    action?: {
        name: string;
        params?: unknown;
        result?: unknown;
    };
    resolvedFiles?: RuntimeAuditResolvedFile[];
    context?: {
        cwd?: string;
        environment?: Record<string, string>;
    };
}
export interface RuntimeAuditEvidence {
    engine: string;
    decision: 'allow' | 'deny' | 'warn' | 'require_approval';
    policyId?: string;
    riskCategories: RuntimeSecurityCategory[];
    reason?: string;
    userTags?: string[];
}
export interface RuntimeAuditResponse {
    auditId: string;
    degraded: boolean;
    evidence: RuntimeAuditEvidence;
    reason?: 'client_error' | 'rate_limited' | 'upstream_unavailable' | 'breaker_open';
    httpStatus?: number;
    detail?: string;
}
export declare class RuntimeAuditAuthenticationError extends Error {
    readonly status = 401;
    constructor();
}
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface RuntimeAuditClientOptions {
    endpoint: string;
    accessToken: string;
    fetch?: FetchLike;
    now?: () => number;
    sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
    log?: (message: string) => void;
}
export declare class RuntimeAuditClient {
    private readonly options;
    private readonly fetch;
    private readonly now;
    private readonly sleep;
    private consecutiveFailures;
    private breakerOpenUntil;
    constructor(options: RuntimeAuditClientOptions);
    postRuntimeAudit(request: RuntimeAuditRequest, options: {
        timeoutMs: number;
        signal?: AbortSignal;
    }): Promise<RuntimeAuditResponse>;
    private url;
    private log;
    private post;
    private handleResponse;
    private recordAvailabilityFailure;
    private recordSuccess;
}
export {};
