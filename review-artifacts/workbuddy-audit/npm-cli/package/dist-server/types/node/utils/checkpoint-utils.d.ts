import { type Checkpoint } from '@genie/cbc-checkpoint';
import { type AgentInputItem, type FileHistorySnapshotItem } from '../../vendor/cbc-shared/node/index.js';
export declare abstract class CheckpointUtils {
    private static readonly editTools;
    static convertSnapshotToCheckpoint(snapshot: FileHistorySnapshotItem, cwd?: string): Checkpoint;
    static getRewindableCheckpoints(activeHistory: AgentInputItem[], cwd?: string): Checkpoint[];
    private static buildCheckpointFromUserMessage;
}
