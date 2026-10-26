/**
 * Session-tier settings — the served replacement for the CLI settings scope
 * (W3, docs/cloud-native/agent-cli-server.md §4.7): for a served
 * session the query is its CLI, so `QueryOptions.settings` takes the seat the
 * `--settings` inline JSON holds for a bin process. Storage is a WeakMap side
 * table resolved through the current run's session, mirroring the sandbox /
 * data-fs mounts: no binding means the bin path stays dormant with zero
 * behavior change. Consumption points: SettingsManager merged reads overlay
 * this tier above every scope; ToolPermissionService seeds its rules into the
 * 'session' rule-source buckets.
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { Settings } from './settings-protocol';
/** A served session may narrow the process's enabled filesystem settings sources. */
export declare function setSessionSettingSources(session: Session, sources: readonly string[] | undefined): void;
export declare function currentSessionSettingSources(): readonly string[] | undefined;
/** Bind (or clear, with undefined) the session-tier snapshot for one session. */
export declare function setSessionSettings(session: Session, settings: Settings | undefined): void;
/** The bound snapshot for an explicitly known session (activation-time seeding). */
export declare function getSessionSettings(session: Session | undefined): Settings | undefined;
/** The bound snapshot for the root scope's session; undefined outside runs. */
export declare function currentSessionSettings(): Settings | undefined;
/**
 * Merge runtime-derived plugin enablement into only the active served
 * request's settings tier. The replacement snapshot remains owned by the
 * request Session WeakMap and disappears with the normal session cleanup.
 */
export declare function mergeCurrentSessionEnabledPlugins(enabledPlugins: Record<string, boolean>): boolean;
