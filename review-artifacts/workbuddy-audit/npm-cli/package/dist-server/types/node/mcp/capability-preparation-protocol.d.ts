import type { Session } from '../../vendor/cbc-core/node/index.js';
export declare const CapabilityPreparationService: unique symbol;
export interface PreparedCapabilities {
    reason: string;
    durationMs: number;
    serverCount: number;
    failedServers: string[];
}
export interface CapabilityPreparationService {
    startProcessPreparation(reason: string): void;
    startSessionPreparation(session: Session, reason: string): void;
    ensureSessionViewPrepared(session: Session): Promise<void>;
    invalidateSession(session: Session, reason: string): void;
}
