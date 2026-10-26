import { AsyncLocalStorage } from 'node:async_hooks';
import { type ModelCallAgentType, type ModelCallCompaction, type Session } from '../../vendor/cbc-core/node/index.js';
import type { Model } from '@openai/agents-core';
import { type HarnessStep } from './harness-metadata';
import type { ResponsesUpstream } from './responses-wire';
export interface ModelMessageCorrelation {
    messageId: string;
    conversationRequestId?: string;
    /** Agent-loop step of this call (`providerData.stepSeq`); auxiliary calls repeat the latest step. */
    stepSeq: number;
    purpose?: string;
    agentType: ModelCallAgentType;
    agentLoop: boolean;
    /** This call's place in its request's agent-loop chain; absent for auxiliary calls. */
    harnessStep?: HarnessStep;
    /** Compaction lineage for the gateway headers and `chat_message_send`; not stamped onto history. */
    compaction: ModelCallCompaction;
    attemptNo?: number;
    attemptStartedAt?: number;
    attemptOpen?: boolean;
    firstTokenAt?: number;
    finishReason?: string;
    abortSignal?: AbortSignal;
    observer?: ModelCallAttemptObserver;
    /** Responses API upstream facts, filled by the HTTP adapter once headers arrive; stamped onto output items. */
    upstream?: ResponsesUpstream;
    /** Attempts before the current one, in order; filled by `completeRetriedModelAttempt`. */
    retriedAttempts?: RetriedModelAttempt[];
}
/** One provider attempt of a model call that failed and was retried. */
export interface RetriedModelAttempt {
    attemptNo: number;
    startedAt: number;
    firstTokenAt?: number;
    endedAt: number;
    /** Never headers, request config or response bodies. */
    error: {
        message: string;
        code?: string;
        status?: number;
    };
}
export interface ModelCallAttemptCompletion {
    correlation: ModelMessageCorrelation;
    response?: unknown;
    error?: unknown;
}
export type ModelCallAttemptObserver = (completion: ModelCallAttemptCompletion) => void;
/** The HTTP adapter and model events share one request-local snapshot. */
export declare const modelMessageCorrelation: AsyncLocalStorage<ModelMessageCorrelation>;
export declare function withModelMessageCorrelation(model: Model, session: Session, observer?: ModelCallAttemptObserver): Model;
/** Closes one visible provider retry attempt; the wrapper will close the final attempt. */
export declare function completeRetriedModelAttempt(error: unknown): void;
/** Starts the next real provider request after retry backoff has completed. */
export declare function startRetriedModelAttempt(): void;
