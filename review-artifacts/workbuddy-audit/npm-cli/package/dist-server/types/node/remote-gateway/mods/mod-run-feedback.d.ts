import { type Session } from '../../../vendor/cbc-core/node/index.js';
import { type ModRunDiagnostic } from '../../../vendor/cbc-shared/common/index.js';
import type { AuthoredModRun } from './authored-mod-protocol';
export interface ModRunNotice {
    pluginId: string;
    runId: string;
    packageId: string;
    status: 'running' | 'failed';
    error?: string;
    diagnostic?: ModRunDiagnostic;
}
export interface ModRunNoticeEntry {
    key: string;
    notice: ModRunNotice;
}
/** Changed run receipts only. No app catalog or business records enter the model context automatically. */
export declare class ModRunFeedback {
    private readonly pending;
    record(session: Session, pluginId: string, run: AuthoredModRun): void;
    snapshot(session: Session): ModRunNoticeEntry[];
    acknowledge(session: Session, keys: readonly string[]): void;
}
