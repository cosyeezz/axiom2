import { Application, ApplicationLifecycle } from '@celljs/core';
import { EventProcessContext, EventProcessor, TracerProvider } from '@genie/telemetry';
type TelemetryAttributeValue = string | number | boolean;
/** Baggage entries of the current turn; `{}` outside a turn. */
export declare function currentTurnBaggageAttributes(): Record<string, string>;
/** Merge current turn baggage with explicit values taking precedence. */
export declare function mergeCurrentTurnBaggage<T extends TelemetryAttributeValue>(explicit: Readonly<Record<string, T>> | undefined): Record<string, string | T>;
/** Stamps turn baggage onto report events without replacing explicit fields. */
export declare class TurnBaggageEventProcessor implements EventProcessor {
    process({ event }: EventProcessContext): Promise<void>;
}
/**
 * Single registration point for the baggage-to-span-attribute processor.
 * TracerProvider.attachSpanProcessor is idempotent per instance and re-attaches
 * to the Galileo global provider when that registers later, so no other code
 * path needs to know this processor exists.
 */
export declare class TurnBaggageSpanProcessorLifecycle implements ApplicationLifecycle<Application> {
    protected readonly tracerProvider?: TracerProvider;
    private readonly processor;
    initialize(): void;
}
export {};
