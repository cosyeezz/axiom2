import { type InterruptionService, type Session, type SessionRunStateMachine } from '../../vendor/cbc-core/node/index.js';
import { type Observable } from 'rxjs';
import { type AgentJobView } from './agent-view-protocol';
export declare const IN_PROCESS_AGENT_JOB_PREFIX = "in-process:";
export declare function inProcessAgentJobs$(): Observable<readonly AgentJobView[]>;
export declare function getInProcessAgentJobs(): readonly AgentJobView[];
/** 取回投影背后的真实 Session（handoff 到后台 worker 时需要它的历史） */
export declare function getInProcessAgentSession(id: string): Session | undefined;
/** 是否有就地会话正在推进（busy）—— attach 其它会话前的守卫判据 */
export declare function hasBusyInProcessAgentJob(): boolean;
export declare function isInProcessAgentJob(job: AgentJobView | undefined): boolean;
export declare function startInProcessAgentJob(session: Session, stateMachine: SessionRunStateMachine, cwd: string, interruptionService?: InterruptionService): string;
export declare function clearInProcessAgentJob(id: string | undefined): void;
export declare function resetInProcessAgentJobs(): void;
export declare function inProcessAgentJobId(sessionId: string): string;
