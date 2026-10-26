/**
 * Symbol for injecting the original ModelProvider before rebind.
 * Used by RecordReplayModelProvider to delegate to the real provider in record/passthrough mode.
 */
export declare const OriginalModelProvider: unique symbol;
/**
 * A single entry in a recording file.
 *
 * Recording files use JSONL format (one JSON object per line).
 * Each model turn produces a pair: one request entry + one response/stream_response entry.
 */
export interface RecordEntry {
    /** Entry type: 'request' for inputs, 'response' for non-streaming, 'stream_response' for streaming */
    type: 'request' | 'response' | 'stream_response';
    /** Sequential turn identifier — request and response share the same turnId */
    turnId: number;
    /** Model name used for this turn */
    modelName?: string;
    /** Timestamp in milliseconds */
    timestamp: number;
    /** Whether this turn used streaming */
    streaming: boolean;
    /** Serialized ModelRequest (only for type='request') */
    request?: any;
    /** Serialized ModelResponse (only for type='response') */
    response?: any;
    /** Recorded StreamEvent sequence with timing (only for type='stream_response') */
    events?: Array<{
        event: any;
        offsetMs: number;
    }>;
}
/**
 * Recording metadata written as the first line of a recording file.
 */
export interface RecordingMetadata {
    type: 'metadata';
    version: 1;
    createdAt: string;
    cliVersion?: string;
    /** Environment variables that should be applied during replay */
    replayEnv?: Record<string, string>;
    /** Explicit runtime-model -> recorded-model aliases for durable fixtures. */
    modelAliases?: Record<string, string>;
}
/**
 * Environment variables that are automatically captured during recording
 * and applied during replay to ensure consistent behavior.
 */
export declare const REPLAY_ENV_KEYS: readonly ["CODEBUDDY_MEMORY_RELEVANCE_DISABLED", "CODEBUDDY_MEMORY_EXTRACTION_DISABLED", "CODEBUDDY_DISABLE_AUTO_MEMORY", "CODEBUDDY_CODE_DISABLE_TERMINAL_TITLE", "CODEBUDDY_CODE_DISABLE_SESSION_SUMMARY", "CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS"];
export declare const RecordingStore: unique symbol;
export interface RecordingStore {
    /** Get the next sequential turn ID (recording mode) */
    nextTurnId(): number;
    /** Write an entry to the recording file (recording mode) */
    writeEntry(entry: RecordEntry | RecordingMetadata): void;
    /** Consume the next response/stream_response entry for a given model (replay mode) */
    consumeNextResponse(modelName: string): RecordEntry | undefined;
    /** Peek at the next response entry for a given model without consuming it */
    peekNextResponse(modelName: string): RecordEntry | undefined;
    /** Get total number of response entries in the recording */
    getResponseCount(): number;
    /** Get all model names that have recorded responses */
    getRecordedModelNames(): string[];
    /** Close file handles */
    close(): void;
}
/**
 * Environment variable names for record/replay configuration.
 */
export declare const ENV_RECORD_DIR = "CODEBUDDY_RECORD_DIR";
export declare const ENV_REPLAY_DIR = "CODEBUDDY_REPLAY_DIR";
export declare const ENV_REPLAY_SPEED = "CODEBUDDY_REPLAY_SPEED";
export declare const ENV_REPLAY_STRICT = "CODEBUDDY_REPLAY_STRICT";
/**
 * Determine the current record/replay mode from environment variables.
 */
export declare function getRecordReplayMode(): 'passthrough' | 'record' | 'replay';
