import type { FormattedSessionEvent, SessionOutputFormat, SessionSourceEvent } from '../types';
/** Created once per subscriber; native and messages subscriptions never load ACP. */
export declare function createSessionFormatter<F extends SessionOutputFormat>(format: F): (source: SessionSourceEvent) => Promise<FormattedSessionEvent<F>[]>;
