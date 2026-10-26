/**
 * Trace Collector Processor — SDK TracingProcessor adapter
 *
 * Bridges @openai/agents SDK tracing to our TraceCollectorService.
 * Registered via addTraceProcessor() in TraceServiceLifecycle.initialize().
 */
import type { Span, Trace, TracingProcessor } from '@openai/agents';
export declare class TraceCollectorProcessor implements TracingProcessor {
    private readonly collector;
    onTraceStart(trace: Trace): Promise<void>;
    onTraceEnd(trace: Trace): Promise<void>;
    onSpanStart(span: Span<any>): Promise<void>;
    onSpanEnd(span: Span<any>): Promise<void>;
    shutdown(): Promise<void>;
    forceFlush(): Promise<void>;
}
