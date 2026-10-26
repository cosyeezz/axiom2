/**
 * Tool Call Loop Detector — Protocol
 *
 * DI Symbol, interface, and shared types for the loop detection service.
 */
import type { AgentInputItem } from '../../../cbc-shared/node/index.js';
export declare const ToolCallLoopDetector: unique symbol;
/**
 * The model call input structure passed to callModelInputFilter.
 */
export interface ModelCallInput {
    input: AgentInputItem[];
    instructions?: string;
}
export interface ToolCallLoopDetector {
    /**
     * Check model call input for tool call loops.
     * Returns modified input with stop message injected if loop detected, or null otherwise.
     */
    check(modelCallInput: ModelCallInput): ModelCallInput | null;
}
export interface LoopDetectionResult {
    detected: boolean;
    toolName?: string;
    reason?: 'generic_loop' | 'read_file_loop';
    consecutiveCount?: number;
    /** The stop message to inject into the model input */
    message?: string;
}
/**
 * Marker injected into the input to indicate a loop has been detected.
 * Used to prevent re-triggering detection on the same input after injection.
 */
export declare const LOOP_DETECTION_MARKER = "[LOOP_DETECTED]";
//# sourceMappingURL=tool-call-loop-detector-protocol.d.ts.map