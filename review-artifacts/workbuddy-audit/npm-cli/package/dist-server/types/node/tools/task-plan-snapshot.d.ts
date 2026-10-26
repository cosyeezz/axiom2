import type { TaskStorageSnapshot } from './task-storage-service';
import type { ToolResult } from './tool-protocol';
/** Project only standard ACP v2 plan fields into the persisted private sidecar. */
export declare function toAcpV2PlanSnapshot(snapshot: TaskStorageSnapshot | undefined): ToolResult['acpV2PlanSnapshot'];
