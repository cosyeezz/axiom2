import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { Logger, W3CTraceContextMeta } from '@genie/telemetry';
import type { A2aClientService, A2aRegisteredAgent } from './a2a-protocol';
/**
 * Arm a user-cancel → remote `tasks/cancel` for an outbound A2A task that was
 * just submitted and is still running remotely. Idempotent per
 * `(session, agent, task)` on a given signal.
 */
export declare function armOutstandingTaskCancel(params: {
    session: Session | undefined;
    client: A2aClientService | undefined;
    agent: A2aRegisteredAgent;
    taskId: string;
    traceContext?: Readonly<W3CTraceContextMeta>;
    logger?: Pick<Logger, 'info' | 'debug'>;
}): void;
/**
 * Disarm the task: whoever now owns its cancellation (the poll loop, or an
 * explicit `A2ACancelTask`) has taken over, so the submit-time listener must
 * not also fire — otherwise the remote gets two `tasks/cancel` for one task.
 * A no-op when nothing was armed.
 */
export declare function disarmOutstandingTaskCancel(sessionId: string, agentId: string, taskId: string): void;
/** Test-only reset of {@link armed} (module-lifetime map in production). */
export declare function __resetOutstandingTasksForTest(): void;
