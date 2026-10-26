import type { Session } from './session-protocol';
import { SessionRunStateMachine, SessionRunStateProjection, SessionRunStateProjectionOptions, SessionRunStateProjectionService } from './session-run-state-machine-protocol';
export declare class SessionRunStateProjectionServiceImpl implements SessionRunStateProjectionService {
    protected readonly stateMachine: SessionRunStateMachine;
    private readonly sequences;
    private readonly runIds;
    private readonly generatedRunCounters;
    private readonly runStartTransitions;
    project(session: Session, options?: SessionRunStateProjectionOptions): SessionRunStateProjection;
    reset(sessionId?: string): void;
    private nextSequence;
    private resolveRunId;
    private nextGeneratedRunId;
    private isRunStartTransitionHandled;
    private markRunStartTransitionHandled;
    private isRunStartTransition;
    private isTerminalIdleTransition;
}
//# sourceMappingURL=session-run-state-projection-service.d.ts.map