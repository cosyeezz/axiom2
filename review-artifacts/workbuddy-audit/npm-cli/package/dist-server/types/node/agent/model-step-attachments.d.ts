import { type Provider } from '@celljs/core';
import { type ModelStepAttachmentProvider as AttachmentProvider, type Session } from '../../vendor/cbc-core/node/index.js';
import type { AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
import { ModRunAttachmentProvider } from './mod-run-attachment';
/** CLI composition root for optional model-step attachments; core has no knowledge of Mods. */
export declare class CliModelStepAttachments implements AttachmentProvider {
    protected readonly mods: Provider<ModRunAttachmentProvider>;
    restoreAttachments(input: AgentInputItem[], session: Session): void;
    getAttachment(input: AgentInputItem[], session: Session, tools: readonly string[]): Promise<AgentInputItem | undefined>;
}
