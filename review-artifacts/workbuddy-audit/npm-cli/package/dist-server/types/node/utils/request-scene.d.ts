import { type Session } from '../../vendor/cbc-core/node/index.js';
/** Query defaults share the existing W3C baggage scope; no separate metadata store. */
export declare function requestSceneBaggage(meta: Record<string, unknown> | null | undefined): Record<string, string>;
/** Scene is attribution only; it must not change permission mode or execution settings. */
export declare function resolveRequestScene(session: Pick<Session, 'meta'>): string | undefined;
