import { AgentManager } from '../../../vendor/cbc-core/node/index.js';
import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
export declare const AutoModeTranscriptLimit: unique symbol;
export interface TranscriptLimitCheck {
    tooLong: boolean;
    actualTokens: number;
    limitTokens: number;
}
/**
 * Resolves the classifier model's usable transcript-token budget and checks a
 * serialized transcript against it.
 *
 * Mirrors Claude Code 2.1.179 `transcript_too_long`: before calling the model,
 * compare the transcript token estimate against the classifier model's context
 * window (minus system-prompt and output reserves). The transcript is the whole
 * conversation, so on long sessions this is a real limit — exceeding it must NOT
 * hard-call the model (which would just error); the host falls back / aborts.
 */
export interface AutoModeTranscriptLimit {
    check(transcript: string): Promise<TranscriptLimitCheck>;
}
export declare class AutoModeTranscriptLimitImpl implements AutoModeTranscriptLimit {
    protected readonly agentManager: AgentManager;
    protected readonly productManager: ProductManager;
    protected readonly logger: Logger;
    check(transcript: string): Promise<TranscriptLimitCheck>;
    private resolveLimit;
}
