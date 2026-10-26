/**
 * Tool Call Loop Detector — Service Implementation
 *
 * Detects when the model is stuck in a loop issuing identical tool calls.
 * Used by RunnerFactory to check and inject stop messages before the loop
 * wastes tokens/credits.
 *
 * Detection rules:
 * 1. Generic loop: blacklisted tool with semantically identical JSON arguments 4 consecutive times
 * 2. Read file loop: Read tool targeting the same file_path 40 consecutive times
 * 3. Non-blacklist loop: any tool NOT in blacklist with semantically identical JSON arguments 40 consecutive times
 */
import type { AgentInputItem } from '../../../cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { LoopDetectionResult, ModelCallInput, ToolCallLoopDetector } from './tool-call-loop-detector-protocol';
export declare class ToolCallLoopDetectorImpl implements ToolCallLoopDetector {
    protected readonly logger: Logger;
    check(modelCallInput: ModelCallInput): ModelCallInput | null;
    /**
     * Core detection logic. Scans from the tail of the input array,
     * examining consecutive `function_call` items.
     */
    protected detectLoop(input: AgentInputItem[]): LoopDetectionResult;
    /**
     * Check if the LOOP_DETECTION_MARKER is already present in the input.
     */
    protected hasExistingMarker(input: AgentInputItem[]): boolean;
    /**
     * Collect function_call items from the tail of the input, stopping at the first item that
     * is neither a function_call nor sequence-transparent (see SEQUENCE_TRANSPARENT_ITEM_TYPES).
     *
     * `blacklisted` selects which side of LOOP_DETECTION_TOOL_BLACKLIST to collect. Calls on the
     * other side are skipped without breaking, so interleaved sequences (e.g. Read, Agent, Read,
     * Agent) still accumulate on both channels independently.
     */
    protected collectTailCalls(input: AgentInputItem[], blacklisted?: boolean): Array<{
        name: string;
        arguments: string;
    }>;
    /**
     * Check for generic loop: same tool with semantically identical JSON arguments
     * N consecutive times. Malformed or very large argument payloads retain exact-string semantics.
     */
    protected checkGenericLoop(tailCalls: Array<{
        name: string;
        arguments: string;
    }>): LoopDetectionResult;
    /**
     * Check for non-blacklist tool loop: any tool NOT in the blacklist with semantically identical JSON arguments
     * called N consecutive times (threshold: NON_BLACKLIST_LOOP_THRESHOLD).
     * Scans from the tail of input, collecting only non-blacklist function_call items.
     */
    protected checkNonBlacklistLoop(input: AgentInputItem[]): LoopDetectionResult;
    /**
     * Check for Read file loop: Read tool targeting the same file_path N consecutive times.
     */
    protected checkReadFileLoop(tailCalls: Array<{
        name: string;
        arguments: string;
    }>): LoopDetectionResult;
    /**
     * Build the bilingual stop message for loop detection.
     */
    protected buildStopMessage(toolName: string, count: number, reason: 'generic_loop' | 'read_file_loop'): string;
    /**
     * Extract the `file_path` field from a Read tool call's arguments string.
     */
    protected extractFilePath(argsStr: string): string | undefined;
}
//# sourceMappingURL=tool-call-loop-detector-service.d.ts.map