import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { AcpAgent } from '../acp/acp-protocol';
import type { PromptSuggestionService } from '../prompt-suggestion/prompt-suggestion-protocol';
export interface ModsPromptUiInput {
    text: string;
}
export interface ModsPromptUiRequest {
    requestId: string;
    sessionId: string;
    kind: 'fill' | 'submit';
    text: string;
}
export interface ModsPromptUiAck {
    requestId: string;
    accepted: boolean;
    error?: string;
}
export interface ModsPromptUiBindings {
    fillPrompt(input: ModsPromptUiInput, signal: AbortSignal): Promise<{
        accepted: true;
    }>;
    submitPrompt(input: ModsPromptUiInput, signal: AbortSignal): Promise<{
        accepted: true;
    }>;
    suggestPrompt(input: ModsPromptUiInput, signal: AbortSignal): Promise<{
        accepted: true;
    }>;
}
export interface ModsPromptUiDependencies {
    /** Resolve the invocation's session context, never a newly selected UI session. */
    getSession(): Session;
    /** Return an empty map when ACP is not installed (e.g. a terminal-only host). */
    getAcpAgents(): ReadonlyMap<string, AcpAgent>;
    getSuggestionService(): Pick<PromptSuggestionService, 'publishSuggestion'>;
}
type PromptUiListener = (request: ModsPromptUiRequest) => void;
export declare function currentModsUiConnection(): string | undefined;
/** Trusted ACP caller identity; never supplied in Mod code or request arguments. */
export declare function withModsPromptUiConnection<T>(connectionId: string | undefined, run: () => T): T;
/** A mounted input owns one surface; cleanup cannot unregister its replacement. */
export declare function subscribeModsPromptUi(session: Session, listener: PromptUiListener): () => void;
/** ACP extension entry point; the caller supplies its authenticated connection/session. */
export declare function acknowledgeModsPromptUi(sessionId: string, connectionId: string, ack: ModsPromptUiAck): boolean;
/** Validate exactly the server-issued submission, then consume its receipt once. */
export declare function consumeModsPromptUiSubmission(session: Session, connectionId: string | undefined, requestId: unknown, blocks: readonly unknown[]): boolean;
/** Connection disposal/rebinding retires both unacknowledged and unsubmitted operations. */
export declare function cancelModsPromptUiRequests(connectionId: string | undefined): void;
/** Lazy host lookups; no queue/state machine besides the existing input surfaces. */
export declare function createModsPromptUiBindings(deps: ModsPromptUiDependencies): ModsPromptUiBindings;
export {};
