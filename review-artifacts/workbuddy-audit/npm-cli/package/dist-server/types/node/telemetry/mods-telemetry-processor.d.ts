import { type EventProcessContext, EventProcessor } from '@genie/telemetry';
/**
 * Official `telemetry.log`: each first-party row the engine logs goes down the
 * chain (`to: 'anthropic'`, cbc's own analytics) before it is sent; a hook may
 * rewrite what it carries, never where it goes. Only numeric and boolean
 * properties are handed (a row carries no free text), and only they are written back.
 */
export declare class ModsTelemetryEventProcessor implements EventProcessor {
    process({ code, event }: EventProcessContext): Promise<void>;
}
