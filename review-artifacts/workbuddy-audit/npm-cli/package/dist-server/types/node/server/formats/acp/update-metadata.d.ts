import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { FileChangeArtifact } from '../../../tools/file-change-artifact';
export declare function attachAcpV2FileChangeArtifact<Update extends SessionUpdate>(update: Update, artifact: FileChangeArtifact | undefined): Update;
export declare function attachAcpV2FileChangeRawInput<Update extends SessionUpdate>(update: Update, rawInput: Record<string, unknown> | undefined): Update;
export declare function readAcpV2FileChangeArtifact(update: SessionUpdate): FileChangeArtifact | undefined;
export declare function readAcpV2FileChangeRawInput(update: SessionUpdate): Record<string, unknown> | undefined;
/** Preserve every process-local v2 sidecar across broadcast fan-out cloning. */
export declare function cloneAcpUpdatePreservingV2Sidecars<Update extends SessionUpdate>(update: Update): Update;
export interface AcpV2TaskPlanSnapshot {
    sourceId: string;
    revision: string;
    entries: unknown[];
}
export declare function parsePersistedAcpV2TaskPlanSnapshot(value: unknown): AcpV2TaskPlanSnapshot | undefined;
export declare function attachAcpV2TaskPlanSnapshot<Update extends SessionUpdate>(update: Update, snapshot: AcpV2TaskPlanSnapshot | undefined): Update;
export declare function readAcpV2TaskPlanSnapshot(update: SessionUpdate): AcpV2TaskPlanSnapshot | undefined;
/**
 * `structuredClone` intentionally drops symbol-keyed properties. Broadcast
 * fan-out needs an explicit reattachment so every v2 connection receives the
 * same private source snapshot while v1 JSON remains unchanged.
 */
export declare function cloneAcpUpdatePreservingV2TaskPlanSnapshot<Update extends SessionUpdate>(update: Update): Update;
