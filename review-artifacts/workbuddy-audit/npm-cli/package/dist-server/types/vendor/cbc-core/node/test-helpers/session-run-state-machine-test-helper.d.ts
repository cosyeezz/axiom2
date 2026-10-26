import { Container } from 'inversify';
import type { Session } from '../session/session-protocol';
import { SessionRunEvent, SessionRunEventType, SessionRunStateMachine, SessionRunStateSnapshot, SessionRunStatus } from '../session/session-run-state-machine-protocol';
export interface SessionRunStateMachineStubOptions {
    readonly initialStatus?: SessionRunStatus;
    readonly busyForQueue?: boolean | ((session: Session, snapshot: SessionRunStateSnapshot) => boolean);
    readonly transitionStatus?: Partial<Record<SessionRunEventType, SessionRunStatus>>;
    readonly transitionThrows?: Error | ((session: Session, event: SessionRunEvent) => Error);
}
export interface SessionRunStateMachineTransitionAttempt {
    readonly session: Session;
    readonly event: SessionRunEvent;
    readonly from: SessionRunStatus;
    readonly to: SessionRunStatus;
    readonly applied: boolean;
}
export interface RecordingSessionRunStateMachine extends SessionRunStateMachine {
    readonly attempts: SessionRunStateMachineTransitionAttempt[];
    readonly records: SessionRunStateMachineTransitionAttempt[];
    readonly events: SessionRunEventType[];
    readonly forceIdleReasons: string[];
    setStatus(session: Session, status: SessionRunStatus, reason?: string): SessionRunStateSnapshot;
}
export declare function createSessionRunStateMachineStub(options?: SessionRunStateMachineStubOptions): RecordingSessionRunStateMachine;
export declare function bindSessionRunStateMachine(container: Container, stateMachine?: SessionRunStateMachine): SessionRunStateMachine;
export declare function createTestContainerWithSessionRunStateMachine(stateMachine?: SessionRunStateMachine): Container;
//# sourceMappingURL=session-run-state-machine-test-helper.d.ts.map