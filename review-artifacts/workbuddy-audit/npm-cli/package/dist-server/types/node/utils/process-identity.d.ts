export declare const PROCESS_IDENTITY_MATCH_TOLERANCE_MS = 2000;
export declare const PROCESS_IDENTITY_QUERY_TIMEOUT_MS = 5000;
export interface ProcessIdentity {
    procStart?: string;
    procStartFt?: string;
    /** Linux /proc/<pid>/stat field 22, stable for one PID generation. */
    procStartTicks?: string;
}
export declare function unixMsToWindowsFileTime(unixMs: number): string;
export declare function windowsFileTimeToUnixMs(fileTime: string | undefined): number | undefined;
export declare function getProcessIdentityStartMs(identity: ProcessIdentity): number | undefined;
export declare function parseLinuxProcStatStartTicks(raw: string): string | undefined;
export interface LinuxClockInfo {
    bootTimeMs: number;
    ticksPerSecond: number;
}
export declare function parseLinuxBootTimeMs(raw: string): number | undefined;
export declare function parseLinuxAuxvClockTicks(raw: Buffer, wordSize?: number, byteOrder?: 'LE' | 'BE'): number | undefined;
export declare function getCurrentProcessIdentity(platform?: NodeJS.Platform): ProcessIdentity;
export declare function queryLinuxProcessStartIdentity(pid: number, readStat?: (path: string) => Promise<string>, getClockInfo?: () => Promise<LinuxClockInfo | undefined>): Promise<ProcessIdentity | undefined>;
export declare function isProcessAlive(pid: number): boolean;
/**
 * Parse `ps -o etime=` output (`[[dd-]hh:]mm:ss`) into elapsed milliseconds.
 * Returns undefined when the token is missing or malformed.
 */
export declare function parsePsEtimeToMs(raw: string): number | undefined;
export declare function queryProcessStartIdentity(pid: number, platform?: NodeJS.Platform): Promise<ProcessIdentity | undefined>;
export declare function compareProcessIdentities(expected: ProcessIdentity, actual: ProcessIdentity): 'same' | 'different' | 'unknown';
export declare function readProcessIdentity(value: Partial<ProcessIdentity> | Record<string, unknown> | null | undefined): ProcessIdentity;
export declare function hasProcessIdentity(identity: ProcessIdentity | undefined): boolean;
/**
 * True when pid is alive AND (no expected identity / query unknown / identities match).
 * Identity mismatch means the PID was reused — treat as dead.
 */
export declare function isMatchingProcessAlive(pid: number, expected: ProcessIdentity | undefined, options?: {
    isAlive?: (pid: number) => boolean;
    queryIdentity?: (pid: number) => Promise<ProcessIdentity | undefined>;
    currentIdentity?: () => ProcessIdentity;
    platform?: NodeJS.Platform;
}): Promise<boolean>;
