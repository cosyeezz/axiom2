import type { Session } from '../../vendor/cbc-core/node/index.js';
import { type StructuredEventErrorType, type StructuredEventLogger, type StructuredEventRecord, type StructuredEventResult } from '../../vendor/cbc-shared/node/index.js';
export declare const TOOL_CALL_COMPLETED_EVENT = "tool.call.completed";
export type ToolCallKind = 'local' | 'mcp';
export type ToolCallOutcome = StructuredEventResult;
export interface ToolCallOutcomeDecision {
    outcome: ToolCallOutcome;
    errorCode?: string;
    errorType?: StructuredEventErrorType;
}
interface ToolCallEventFields {
    tool_kind: ToolCallKind;
    tool_name: string;
    mcp_server?: string;
}
export type ToolCallOutcomeRecord = StructuredEventRecord<ToolCallEventFields> & {
    raw: string;
};
export interface ToolCallOutcomeLogInput {
    logger: StructuredEventLogger;
    kind: ToolCallKind;
    outcome: ToolCallOutcome;
    toolName: string;
    callId?: string;
    serverName?: string;
    session?: Session;
    startedAt: number;
    error?: unknown;
    errorCode?: string;
    errorType?: StructuredEventErrorType;
}
export declare function logToolCallOutcome(input: ToolCallOutcomeLogInput): ToolCallOutcomeRecord | undefined;
export declare function toolCallOutcomeFromResult(result: unknown): ToolCallOutcomeDecision;
export declare function toolCallOutcomeFromError(error: unknown): ToolCallOutcomeDecision;
export {};
