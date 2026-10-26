import type { Session } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { A2aArtifactDownloadService, type A2aArtifactDownloadStatus, type A2aArtifactSummary } from './a2a-protocol';
/**
 * Outbound A2A artifact download (issue #99451). All four knobs are read LIVE
 * from `process.env` on every call — never cached — matching this repo's
 * prewarm convention and letting tests flip them between calls.
 */
export declare const ENV_ARTIFACT_MAX_SIZE_MB = "CODEBUDDY_A2A_ARTIFACT_MAX_SIZE_MB";
export declare const ENV_ARTIFACT_DOWNLOAD_TIMEOUT_MS = "CODEBUDDY_A2A_ARTIFACT_DOWNLOAD_TIMEOUT_MS";
export declare const ENV_ARTIFACT_AWAIT_MS = "CODEBUDDY_A2A_ARTIFACT_AWAIT_MS";
export declare const ENV_ARTIFACT_DOWNLOAD_ENABLED = "CODEBUDDY_A2A_ARTIFACT_DOWNLOAD_ENABLED";
export interface A2aArtifactDownloadConfig {
    maxSizeBytes: number;
    downloadTimeoutMs: number;
    awaitMs: number;
}
/** Resolved fresh on every call — see module doc comment. */
export declare function resolveArtifactDownloadConfig(): A2aArtifactDownloadConfig;
/** Independent kill switch for the download side effect. */
export declare function isArtifactDownloadEnabled(): boolean;
/**
 * Process-scoped component with Session-owned records and workspace paths.
 * `startDownload` captures the exact sandbox/cwd before launching async work,
 * so a late completion cannot fall through into another session's backend.
 */
export declare class A2aArtifactDownloadServiceImpl implements A2aArtifactDownloadService {
    protected readonly logger: Logger;
    private readonly recordsBySession;
    startDownload(session: Session, artifact: A2aArtifactSummary): void;
    getResult(session: Session, url: string): {
        status: A2aArtifactDownloadStatus;
        localPath?: string;
        error?: string;
    } | undefined;
    awaitPending(session: Session, urls: string[], timeoutMs: number): Promise<void>;
    private recordsFor;
    private failRecord;
    private download;
    private writeArtifact;
    private ensureHostDirectories;
    private sandboxContentMatches;
    private hostContentMatches;
    private atomicWriteHostFile;
}
/** Fire-and-forget trigger for every URL-referenced artifact. */
export declare function startArtifactDownloads(service: A2aArtifactDownloadService | undefined, session: Session, artifacts: A2aArtifactSummary[] | undefined): void;
/** Wait briefly before a terminal result and add completed workspace paths. */
export declare function awaitAndEnrichArtifacts(service: A2aArtifactDownloadService | undefined, session: Session, artifacts: A2aArtifactSummary[] | undefined): Promise<A2aArtifactSummary[] | undefined>;
/** Append the existing model-visible download summary without rewriting text. */
export declare function appendDownloadSummary(text: string, artifacts: A2aArtifactSummary[] | undefined, service: A2aArtifactDownloadService | undefined, session: Session): string;
