import { type AgentInputItem } from '../../../cbc-shared/node/index.js';
import { SessionConsoleHost as ConsoleManager, SessionUsageHost as UserStateManager } from './session-host-protocol';
import { MessageQueueManager, PopAllEditableResult, Session } from './session-protocol';
export declare class MessageQueueManagerImpl implements MessageQueueManager {
    protected readonly userStateManager?: UserStateManager;
    protected readonly consoleManager: ConsoleManager;
    enqueueMessage(session: Session, message: AgentInputItem): string;
    dequeueMessage(session: Session): AgentInputItem | undefined;
    clearQueue(session: Session): void;
    removeMessage(session: Session, index: number): void;
    getQueue(session: Session): AgentInputItem[];
    hasEditableMessage(session: Session): boolean;
    popAllEditable(session: Session, currentInput: string): PopAllEditableResult | undefined;
    popLastEditableQueueHold(session: Session, currentInput: string): PopAllEditableResult | undefined;
    popAllEditableQueueHold(session: Session, currentInput: string): PopAllEditableResult | undefined;
}
//# sourceMappingURL=message-queue-manager.d.ts.map