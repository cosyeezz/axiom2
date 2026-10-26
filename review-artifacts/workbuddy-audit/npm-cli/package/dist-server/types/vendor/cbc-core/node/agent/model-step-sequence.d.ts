import type { Session } from '../session/session-protocol';
type StepSequenceSession = Pick<Session, 'id' | 'history' | 'agentPurpose' | 'modelStepSeq'>;
/** Latest step of the Session's agent loop, restored from persisted history after resume. */
export declare function currentModelStepSeq(session: StepSequenceSession): number;
/**
 * Step number for the model call in the current async chain. Agent-loop calls
 * advance the counter; auxiliary calls reuse the latest step. The counter never
 * resets across runs, compaction continuations or teammate wake-ups.
 */
export declare function allocateModelStepSeq(session: StepSequenceSession): number;
export {};
//# sourceMappingURL=model-step-sequence.d.ts.map