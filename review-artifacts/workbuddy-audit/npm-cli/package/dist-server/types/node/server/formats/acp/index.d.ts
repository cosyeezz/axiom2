import type { FormattedSessionEvent, SessionSourceEvent } from '../../types';
/** Protocol presentation only. The Server remains the owner of run settlement. */
export declare class AcpSessionFormatter {
    private readonly version;
    private readonly lanes;
    private readonly compactions;
    private readonly streamedV1Messages;
    constructor(version: 'acp-v1' | 'acp-v2');
    format(source: SessionSourceEvent): Promise<FormattedSessionEvent<'acp-v1' | 'acp-v2'>[]>;
    private wrap;
    private model;
}
