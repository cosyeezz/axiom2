import type { ModelCallGeneration } from '../session/session-protocol';
/**
 * Marks `error` as the failure of one model call. The call's ids live in the model-call
 * async scope, which does not reach the consumer of the SDK run stream; the error does.
 * An error rethrown through an outer call keeps the innermost call's mark.
 */
export declare function markModelCallFailure<T>(error: T, sessionId: string, generation: ModelCallGeneration): T;
/** The model call of this Session that failed with `error`; undefined when the failure is not one. */
export declare function getFailedModelCall(error: unknown, sessionId: string): ModelCallGeneration | undefined;
//# sourceMappingURL=model-call-failure.d.ts.map