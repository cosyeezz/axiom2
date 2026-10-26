import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { AskAnswers } from './ask-protoctol';
/**
 * A per-session answer channel for AskUserQuestion.
 *
 * Interactive transports bind this only while they own the physical run.
 * The handler returns answers in the same shape already consumed by
 * AskUserQuestionTool, so InterruptionService can reuse its existing
 * approval + RunState continuation path.
 */
export interface SessionAskUserQuestionRequest {
    toolCallId: string;
    input: Record<string, unknown>;
    signal: AbortSignal;
}
export type SessionAskUserQuestionHandler = (request: SessionAskUserQuestionRequest) => Promise<AskAnswers>;
export declare function setSessionAskUserQuestionHandler(session: Session, handler: SessionAskUserQuestionHandler | undefined): void;
export declare function clearSessionAskUserQuestionHandler(session: Session, owner?: SessionAskUserQuestionHandler): void;
export declare function getSessionAskUserQuestionHandler(session: Session | undefined): SessionAskUserQuestionHandler | undefined;
/**
 * Prefer an explicit child-session binding, then fall back to the root run.
 * A child agent's approval item is handled against its child Session, while
 * the A2A task itself owns the root Session.
 */
export declare function resolveSessionAskUserQuestionHandler(session: Session | undefined): SessionAskUserQuestionHandler | undefined;
