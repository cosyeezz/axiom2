/**
 * Structured Output Module Protocol
 *
 * Defines interfaces for the structured output feature.
 * This module provides JSON Schema-based structured output for CLI responses.
 */
import { Deferred } from '@celljs/core';
import { Session } from '../../vendor/cbc-core/node/index.js';
export declare const StructuredOutputContextFactory: unique symbol;
/**
 * Structured Output Context
 *
 * Holds runtime state for structured output processing.
 * Each session has its own context, stored via WeakMap.
 *
 * This replaces adding fields directly to Session interface.
 */
export interface StructuredOutputContext {
    /**
     * Whether structured output is enabled for this session
     */
    enabled: boolean;
    /**
     * The raw JSON Schema string (for display in prompts)
     */
    schemaString?: string;
    /**
     * Captured structured output from StructuredOutput tool
     */
    output?: unknown;
    /**
     * Current retry count
     */
    retryCount: number;
    /**
     * Maximum retries before giving up
     */
    maxRetries: number;
    /**
     * Deferred that resolves when processing is complete
     * Used by callers to wait for completion
     */
    completionDeferred: Deferred<void>;
    /**
     * Mark the context as complete
     * Resolves the completion deferred
     */
    markComplete(): void;
    /**
     * Set the structured output
     * Called by StructuredOutputTool
     */
    setOutput(data: unknown): void;
    /**
     * Increment retry count
     * @returns true if more retries are allowed
     */
    incrementRetry(): boolean;
    /**
     * Check if output has been captured
     */
    hasOutput(): boolean;
}
/**
 * Factory for creating and managing StructuredOutputContext
 * Uses WeakMap for automatic cleanup
 */
export interface StructuredOutputContextFactory {
    /**
     * Get or create a context for a session
     * Creates a new context if one doesn't exist
     */
    getOrCreate(session: Session, schema?: string): StructuredOutputContext;
    /**
     * Get existing context for a session
     * Returns undefined if no context exists
     */
    get(session: Session): StructuredOutputContext | undefined;
    /**
     * Dispose context for a session
     * Called when session ends
     */
    dispose(session: Session): void;
}
/**
 * Default maximum retries for structured output
 */
export declare const DEFAULT_MAX_RETRIES = 4;
/**
 * Feedback message template for structured output
 */
export declare const STRUCTURED_OUTPUT_FEEDBACK_TEMPLATE = "You MUST call the StructuredOutput tool to complete this request.\nThe tool parameters must match this JSON Schema:\n\n{schema}\n\nCall the StructuredOutput tool now with the appropriate data.";
