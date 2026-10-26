import { getCurrentProcessIdentity, hasProcessIdentity, type ProcessIdentity, readProcessIdentity } from '../utils/process-identity';
export type { ProcessIdentity };
export { getCurrentProcessIdentity, hasProcessIdentity, readProcessIdentity };
/** Job 持久化字段允许 null（清身份）；对外统一成 ProcessIdentity（无 null）。 */
export type ProcessIdentityInput = {
    procStart?: string | null;
    procStartFt?: string | null;
    procStartTicks?: string | null;
} | Partial<ProcessIdentity> | Record<string, unknown> | null | undefined;
export declare function identityFromJob(value: ProcessIdentityInput): ProcessIdentity;
export declare function identityPatch(identity: ProcessIdentity | undefined): ProcessIdentity;
export declare function captureProcessIdentity(pid: number): Promise<ProcessIdentity | undefined>;
export declare function isJobProcessAlive(pid: number | undefined, expected: ProcessIdentityInput, isAlive?: (pid: number) => boolean, options?: {
    queryIdentity?: (pid: number) => Promise<ProcessIdentity | undefined>;
    currentIdentity?: () => ProcessIdentity;
}): Promise<boolean>;
export declare const CLEARED_PROCESS_IDENTITY: {
    procStart: null;
    procStartFt: null;
    procStartTicks: null;
};
