/**
 * A2A outbound feature gate (issue #99451).
 *
 * Two independent, AND'd conditions must both hold:
 *  1. The feature switch — `CODEBUDDY_A2A_OUTBOUND_ENABLED` env override OR
 *     `ProductFeature.A2AOutbound` via `AbTestService` (see
 *     `isA2AOutboundEnabled()` below).
 *  2. `CODEBUDDY_REMOTE_AGENTS_URL` is a non-empty string (issue #99451
 *     Part B: the discovery source is now a plain env var, not a
 *     host-pushed `initialize` control_request field — see
 *     `A2aAgentDiscoveryService`'s doc comment).
 *
 * Enforcement is two-layered (per CODEBUDDY.md §10 Feature Gate guidance):
 *   - Exposure layer: the 4 A2A tools hide themselves via `isEnabled` when
 *     the gate is off.
 *   - Execution layer: `execute()` on each tool re-checks the gate before
 *     making any network call, so a stale cached tool-call (history
 *     replay, resumed session) can never bypass a runtime kill-switch.
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
import { type AbTestService } from '@genie/product';
import type { Logger } from '@genie/telemetry';
/**
 * Env var that force-enables outbound A2A independent of cloud product
 * config — set it truthy (`1`/`true`/`yes`/`on`, see `BooleanUtils.isTruthy`)
 * to turn the feature on locally without needing an `AbTestService`/product
 * config round trip. Primarily for local development, manual verification
 * (`scripts/manual-a2a-session.mjs`), and hosts that want a hard override
 * rather than waiting on cloud config propagation.
 *
 * Deliberately **enable-only**: an explicit falsy value (`0`/`false`) does
 * NOT force the feature off — it's treated the same as "unset", falling
 * through to the `ProductFeature.A2AOutbound` check below. The kill-switch
 * authority stays with cloud config (see CODEBUDDY.md §10's kill-switch
 * semantics) so an operator can still remotely disable A2A even on hosts
 * that happen to have this env var lingering in their process environment.
 *
 * Independent of, and AND'd with, `ENV_REMOTE_AGENTS_URL` below — this env
 * var only ever forces the *feature switch* on, never bypasses the
 * "is there actually a discovery URL configured" requirement.
 */
export declare const ENV_A2A_OUTBOUND_ENABLED = "CODEBUDDY_A2A_OUTBOUND_ENABLED";
/**
 * Discovery source for outbound A2A agents (issue #99451 Part B). Read LIVE
 * from `process.env` at the point of use — see `A2aAgentDiscoveryService`'s
 * doc comment for why this must never be cached earlier (prewarm
 * per-session env only lands at `activate`).
 *
 * ANDed into `isA2AOutboundEnabled()`: even if the feature switch is on, the
 * gate stays off with no discovery source configured — there would be
 * nothing to discover, and the 4 A2A tools would otherwise expose
 * themselves to the model only to fail on first use.
 */
export declare const ENV_REMOTE_AGENTS_URL = "CODEBUDDY_REMOTE_AGENTS_URL";
/**
 * The discovery source a session resolves to — the single classification every
 * A2A consumer (gate, registry `resolveView`, discovery `waitForDiscovery`,
 * the session-view input gate) switches on, so the `''` / `== env` / no-seat
 * rules live in exactly one place instead of being re-derived (and drifting)
 * per consumer:
 *   - `process`: the session shares the process directory / env source and its
 *     reactive repaint chain (no seat, or a seat equal to the live env URL);
 *     `url` may be undefined (A2A simply off, but still the process dimension).
 *   - `session`: the session has its own discovery source (`url`), served from
 *     an isolated registry partition.
 *   - `none`: the seat is explicitly `''` — A2A off for this session even when
 *     the process env has a source.
 */
export type A2aDiscoverySource = {
    kind: 'process';
    url: string | undefined;
} | {
    kind: 'session';
    url: string;
} | {
    kind: 'none';
};
export declare function resolveA2aSource(session?: Session): A2aDiscoverySource;
/**
 * 宿主声明进程级发现目录中 Agent 的返回可信，A2A 工具结果据此免于防注入检测。
 * 必须与 {@link ENV_REMOTE_AGENTS_URL} 由同一宿主一并下发；会话级发现源不继承该声明，
 * 宿主要为会话自己表态的发现源声明可信时，随 QueryOptions.remoteAgentsUrl 一并给出
 * QueryOptions.remoteAgentsTrusted（见 a2a-session-source 的策略席位）。
 */
export declare const ENV_A2A_TRUSTED_RESULTS = "CODEBUDDY_A2A_TRUSTED_RESULTS";
export declare function isHostTrustedA2aSource(session?: Session): boolean;
/**
 * Effective discovery URL for a session (thin derivation of
 * {@link resolveA2aSource}): the session's own source, else the process env,
 * else undefined (unset, or an explicit `''` opt-out).
 */
export declare function resolveRemoteAgentsUrl(session?: Session): string | undefined;
/**
 * Resolve whether outbound A2A is enabled — for `session` when given (its
 * discovery source resolves per {@link resolveRemoteAgentsUrl}), else for
 * the process.
 *
 * The discovery source is checked FIRST — cheap, synchronous, and
 * lets us skip the `AbTestService` round trip entirely (and log a specific
 * "off because no URL" reason, distinct from "off because the feature flag
 * is off") when there's no discovery source configured at all. The feature
 * switch stays the operator kill-switch: a session discovery source alone
 * never bypasses it; only the host's own declaration does, through the env
 * override or the session policy seat it states together with the source.
 *
 * Feature-switch check order (first hit wins):
 *   1. `CODEBUDDY_A2A_OUTBOUND_ENABLED` truthy → enabled, no `AbTestService`
 *      round trip needed.
 *   2. `QueryOptions.remoteAgentsEnabled` true on a session that stated its
 *      own discovery source → enabled (the host's per-session equivalent of
 *      the env override; `false` falls through like an unset env var).
 *   3. `ProductFeature.A2AOutbound` via `AbTestService` (existing behavior).
 *      `defaults.enabled = false` — new feature, conservative kill-switch
 *      semantics: stays off until the cloud config explicitly turns it on.
 *      `abTestService` is `undefined` in unassembled-container unit tests;
 *      those paths fall back to disabled, matching the same conservative
 *      default.
 *
 * `logger` is optional (debug-level only — this is called from every A2A
 * tool's `isEnabled`/`execute`, so it must stay quiet by default) and used
 * solely for the Logging section's "why is the gate off" diagnostic — it
 * does not affect the returned value.
 */
export declare function isA2AOutboundEnabled(abTestService?: AbTestService, logger?: Pick<Logger, 'debug'>, session?: Session): Promise<boolean>;
