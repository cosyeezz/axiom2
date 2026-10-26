import { AgentManager, ContextCompactSummarizer, type IdleQueueDrainService as IdleQueueDrainServiceContract, type InterruptionService as InterruptionServiceContract, type ManualCompactRequestHandler as ManualCompactRequestHandlerContract, type Session, SessionRunStateMachine } from '../../../vendor/cbc-core/node/index.js';
import { type AgentInputItem } from '../../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { ConsoleManager } from '../../console';
interface ManualCompactCommand {
    customInstructions?: string;
}
export declare const extractManualCompactCommand: (input: string | AgentInputItem[]) => ManualCompactCommand | undefined;
/** Routes external TUI `/compact` requests before AgentService claims a normal run. */
export declare class ManualCompactRequestHandlerImpl implements ManualCompactRequestHandlerContract {
    protected readonly agentManager: AgentManager;
    protected readonly contextCompactSummarizer: ContextCompactSummarizer;
    protected readonly logger: Logger;
    protected readonly consoleManager: ConsoleManager;
    protected readonly stateMachine: SessionRunStateMachine;
    protected readonly interruptionService?: InterruptionServiceContract;
    protected readonly idleQueueDrainService?: IdleQueueDrainServiceContract;
    private operations?;
    tryHandle(input: string | AgentInputItem[], session: Session): Promise<boolean>;
    compact(session: Session, options?: {
        customInstructions?: string;
        waitForIdle?: boolean;
    }): Promise<boolean>;
    private runCompact;
    private claimIdleCompactWindow;
    private waitForIdleOrApproval;
    private hasPendingApproval;
}
export {};
