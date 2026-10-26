import { type Session } from '../../vendor/cbc-core/node/index.js';
import { type AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
import { AuthoredModRuntime } from '../remote-gateway/mods/authored-mod-runtime';
import { ModRunFeedback } from '../remote-gateway/mods/mod-run-feedback';
import { SettingsManager } from '../settings/settings-protocol';
/** Model-step delivery of this Web UI session's asynchronous activation receipts. */
export declare class ModRunAttachmentProvider {
    protected readonly feedback: ModRunFeedback;
    protected readonly settings: SettingsManager;
    protected readonly runtime: AuthoredModRuntime;
    getAttachment(input: AgentInputItem[], session: Session, tools: readonly string[]): Promise<AgentInputItem | undefined>;
    restoreAttachments(input: AgentInputItem[], session: Session): void;
}
