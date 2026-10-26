import { type RawApiBodiesMode, type Span } from '@genie/telemetry';
import type { Model } from '@openai/agents-core';
export declare const RAW_API_BODIES_INDEX = "index.jsonl";
export type RawApiBodiesTarget = Exclude<RawApiBodiesMode, {
    mode: 'disabled';
}>;
/** Active mode, or undefined when disabled; read per call so env changes (prewarm) apply. */
export declare function resolveRawApiBodies(env?: NodeJS.ProcessEnv): RawApiBodiesTarget | undefined;
/** Request body as sent: JSON text, gzip-decoded when GzipRequestProcessor compressed it. */
export declare function requestBodyText(data: unknown): Promise<string>;
export interface RawApiCallContext {
    /** Turn root span of the calling session; events are skipped without one. */
    span?: Pick<Span, 'addEvent'>;
    model: string;
    querySource?: string;
    warn: (message: string) => void;
}
/** Fire-and-forget: never rejects, failures are reported through `warn`. */
export declare function recordRawApiRequest(target: RawApiBodiesTarget, call: RawApiCallContext & {
    requestBodyId: string;
    body: unknown;
}): Promise<void>;
export interface RawApiSession {
    id: string;
    agentName?: string;
    agentPurpose?: string;
    conversationRequestRootSpan?: Pick<Span, 'addEvent'>;
}
/** `query_source` of a call: the agent purpose (compaction, …) or the agent name. */
export declare function querySourceOf(session: RawApiSession): string | undefined;
/** Records each completed response; runs inside the model-call correlation scope. */
export declare function withRawApiBodies(model: Model, target: RawApiBodiesTarget, context: {
    session: RawApiSession;
    rootSessionId: string;
    model: string;
    warn: (message: string) => void;
}): Model;
