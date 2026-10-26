import type { CompleteElicitationNotification, CreateElicitationRequest, CreateElicitationResponse } from '@agentclientprotocol/sdk';
import type { Session } from '../../vendor/cbc-core/node/index.js';
/**
 * The Host's elicitation channel for a served session (`QueryOptions.elicitation`),
 * the pair ACP sends as `elicitation/create` and `elicitation/complete`.
 * Host-mediated interactions, such as the WeChat Pay confirmation card and A2A
 * approval cards, use it as they use an ACP connection's.
 */
export interface HostElicitation {
    /** Shows the elicitation and resolves with the user's action. */
    createElicitation(params: CreateElicitationRequest, options?: {
        signal?: AbortSignal;
    }): Promise<CreateElicitationResponse>;
    /** Tells the Host that an elicitation it may still show has ended. */
    completeElicitation(params: CompleteElicitationNotification): Promise<void>;
}
/** Bind (or clear, with undefined) at activation, as the permission callback. */
export declare function setSessionElicitation(session: Session, elicitation: HostElicitation | undefined): void;
/** The session's own channel, else its run's main session's. */
export declare function resolveSessionElicitation(session: Session | undefined): HostElicitation | undefined;
