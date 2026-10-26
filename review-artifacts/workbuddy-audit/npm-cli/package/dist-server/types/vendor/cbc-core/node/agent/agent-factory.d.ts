import { type Agent, type AgentOptions } from '../../../cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { SessionRunStateMachine } from '../session/session-run-state-machine-protocol';
import { AgentFactory } from './agent-protocol';
import { type AgentRunScope as IAgentRunScope } from './agent-run-scope';
import { AgentRunObserver, AgentToolRuntime } from './agent-runtime-protocol';
export declare class DefaultAgentFactory implements AgentFactory {
    protected readonly logger: Logger;
    protected readonly toolRuntime: AgentToolRuntime;
    protected readonly stateMachine: SessionRunStateMachine;
    protected readonly agentRunScope?: IAgentRunScope;
    protected readonly runObserver?: AgentRunObserver;
    create(options: AgentOptions): Promise<Agent>;
    private observeRunPhase;
}
//# sourceMappingURL=agent-factory.d.ts.map