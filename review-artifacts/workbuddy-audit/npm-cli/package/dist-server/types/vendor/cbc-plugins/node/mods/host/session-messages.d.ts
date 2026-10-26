/**
 * `$.session.messages()`: the session's history (Agents SDK items) in the
 * official shapes — rows (`SessionMessage[]`) or, with `as: 'api'`, the
 * Messages API form (`ApiMessage[]`).
 *
 * An assistant row carries the calls its turn made (`toolUses`, each with the
 * result it got); the results themselves come back on the user row that
 * follows, as the Messages API carries them (`toolResults`).
 */
import type { ApiMessage, SessionMessage } from '../types/claude-code';
/** History items as official `SessionMessage` rows. */
export declare function toSessionMessages(history: readonly unknown[]): SessionMessage[];
/** History items in the Messages API form (`ApiMessage[]`), consecutive same-role blocks merged. */
export declare function toApiMessages(history: readonly unknown[]): ApiMessage[];
/** What `session.append` hands for one history item: the row, its door and who caused it. */
export interface AppendRow {
    readonly message: {
        type: 'user' | 'assistant' | 'attachment' | 'system';
        role?: 'user' | 'assistant';
        isMeta?: true;
        content: ApiMessage['content'];
    };
    readonly door: string;
    readonly origin: Record<string, unknown>;
}
/**
 * Official `SessionAppendInput` parts of a history item, or undefined for an
 * item the transcript keeps as no row (reasoning, a host-only marker).
 */
export declare function appendRowOf(raw: unknown, model: string | undefined): AppendRow | undefined;
/**
 * Write a hook's rewrite of `session.append` back onto the history item: text
 * blocks and a tool_result's `content` / `is_error`; every other part is the
 * engine's and stays as it was.
 */
export declare function applyAppendRewrite(raw: unknown, stored: unknown): void;
//# sourceMappingURL=session-messages.d.ts.map