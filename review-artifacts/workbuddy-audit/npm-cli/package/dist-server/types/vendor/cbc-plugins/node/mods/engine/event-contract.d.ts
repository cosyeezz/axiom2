import type { EventInput, EventName, EventResult } from '../types';
/** Snapshot event data, without freezing the host's objects or opaque handles. */
export declare function freezeEvent(input: EventInput): EventInput;
/** Validate the result envelope; tool outputs and host capability values stay opaque. */
export declare function validateHookResult(event: EventName, value: unknown): asserts value is EventResult | undefined;
//# sourceMappingURL=event-contract.d.ts.map