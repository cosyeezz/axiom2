export interface ScheduledTaskAgentAssignment {
    agentId: string;
    agentName: string;
    engine: string;
    model?: string;
    permissionMode?: string;
    description?: string;
    isTwin: boolean;
}
export declare class ScheduledTaskAssignmentError extends Error {
    readonly agentId?: string | undefined;
    readonly agentName?: string | undefined;
    constructor(message: string, agentId?: string | undefined, agentName?: string | undefined);
}
export declare function resolveScheduledTaskAgent(agentId?: string): Promise<ScheduledTaskAgentAssignment>;
/** 定时任务会话没有自己的主 job；分身也必须登记，避免误归宿主同事。 */
export declare function registerScheduledTaskSessionOwner(sessionId: string, agentId: string): Promise<void>;
