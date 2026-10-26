/**
 * Structured Output Context Implementation
 *
 * Manages runtime state for structured output processing.
 * Uses WeakMap to avoid polluting the Session interface.
 */
import { Session } from '../../vendor/cbc-core/node/index.js';
import { StructuredOutputContext, StructuredOutputContextFactory } from './structured-output-protocol';
/**
 * Factory implementation using WeakMap for automatic cleanup
 */
export declare class StructuredOutputContextFactoryImpl implements StructuredOutputContextFactory {
    /**
     * WeakMap ensures contexts are automatically garbage collected
     * when their associated sessions are no longer referenced
     */
    private contexts;
    getOrCreate(session: Session, schema?: string): StructuredOutputContext;
    get(session: Session): StructuredOutputContext | undefined;
    dispose(session: Session): void;
}
