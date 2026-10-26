/** Query admission: carry the host's expert members into an autonomous turn's baggage. */
export declare function requestExpertBaggage(meta: Record<string, unknown> | null | undefined): Record<string, string>;
/**
 * The platform headers of the current turn's expert members; `{}` outside a turn
 * or when the host stated none. Callers apply them only to built-in model
 * endpoints and platform requests.
 */
export declare function resolveExpertHeaders(): Record<string, string>;
