/**
 * Policy for client-supplied HTTP headers that agent-cli forwards to the model gateway
 * (`_meta['codebuddy.ai'].customPassthroughHeaders`).
 *
 * Security boundary = the startup prefix allowlist `CODEBUDDY_PASSTHROUGH_HEADER_PREFIXES`
 * (deploy-owned, set by sandbox-proxy when it spawns the codebuddy subprocess; default empty ⇒
 * feature off). Only headers whose name starts with an allowed prefix are forwarded. The deployer
 * is responsible for choosing a prefix namespace **disjoint from the internal `X-*` header space**
 * (auth/identity/trace/IDE/conversation headers) — e.g. `x-wb-`, `x-mobile-`. We deliberately do
 * NOT maintain a parallel denylist of internal header names (it would drift out of sync with the
 * gateway/auth contract); the prefix is the single source of truth. Note that per-request unique
 * IDs (`X-Request-Id` / `X-Conversation-Message-Id` / etc.) are additionally re-asserted by the
 * caller after these headers are applied, so they cannot be overridden regardless of prefix.
 */
/**
 * Parse the comma-separated prefix allowlist env value into a normalized list.
 * Lowercased, trimmed, empties dropped. `undefined`/empty ⇒ `[]` (feature off).
 */
export declare function parsePrefixes(raw?: string): string[];
/**
 * Keep only headers whose (lowercased) name starts with one of `prefixes`. Empty `prefixes` ⇒
 * everything dropped (feature off). Non-string values and prototype-pollution keys are dropped.
 * Returns a null-prototype-safe plain object with original-cased keys preserved.
 */
export declare function filterPassthroughHeaders(headers: Record<string, string>, prefixes: string[]): Record<string, string>;
/**
 * Resolve the client-supplied `customPassthroughHeaders` payload into the value that should be
 * written to `session.requestOptions.customPassthroughHeaders` for this turn.
 *
 * Single source of truth for every inbound transport (stream-json `AgentController` and ACP
 * `AcpView`), so the security policy (raw-shape validation + prefix allowlist + "empty ⇒ clear")
 * can never drift between them. Returns:
 * - `undefined` when `raw` is not a plain object, or when nothing survives the prefix allowlist
 *   (feature off / all headers rejected) — callers use this to clear the slot (no cross-turn bleed);
 * - otherwise the filtered header map (original casing preserved).
 *
 * `prefixEnvValue` is the raw `CODEBUDDY_PASSTHROUGH_HEADER_PREFIXES` value each caller resolves from
 * its own settings/env (kept out of here so this stays pure and trivially testable).
 */
export declare function resolvePassthroughHeaders(raw: unknown, prefixEnvValue: string | undefined): Record<string, string> | undefined;
