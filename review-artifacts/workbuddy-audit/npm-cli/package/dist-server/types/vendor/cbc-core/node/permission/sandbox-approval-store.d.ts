/**
 * Session-scoped approval cache for sandbox escalations.
 *
 * Mirrors Codex's `ApprovalStore` (codex-rs/core/src/tools/sandboxing.rs).
 * Stores the user's `allow_session` decisions keyed by the combination of the
 * canonicalised command (see canonicalize-command.ts) and the command's cwd.
 *
 * - Only `allow_session` writes into this store. `allow_once` is ephemeral and
 *   `deny` is not cached so the user can reconsider on a later invocation.
 * - The store is tied to the lifetime of a single Session: when the user
 *   invokes /clear or the backing Session object is replaced, `clear()` must
 *   be called to prevent cross-session leakage.
 */
export declare const SandboxApprovalStore: unique symbol;
/** Cache key components. The caller is responsible for canonicalising them. */
export interface SandboxApprovalKey {
    /** Result of `canonicalizeCommand(command)`. */
    canonicalCommand: string;
    /** Absolute path, normalised by the caller. */
    cwd: string;
}
/**
 * The only decision we currently cache. We keep it as a literal string type
 * rather than a boolean so future decision kinds (e.g. `allow_always_global`)
 * can be added without breaking the Map shape.
 */
export type SandboxApprovalValue = 'approved_for_session';
export interface SandboxApprovalStore {
    /**
     * Look up a cached decision. Returns `undefined` when the key has never
     * been approved or has been cleared.
     */
    get(key: SandboxApprovalKey): SandboxApprovalValue | undefined;
    /**
     * Record an `allow_session` approval. Calling with an already-present key
     * is a no-op from the caller's perspective.
     */
    put(key: SandboxApprovalKey): void;
    /**
     * Drop all entries. Intended for session switch / reset events.
     */
    clear(): void;
    /**
     * Current entry count. Mainly used by diagnostics and tests.
     */
    size(): number;
}
export declare class SandboxApprovalStoreImpl implements SandboxApprovalStore {
    private readonly _map;
    get(key: SandboxApprovalKey): SandboxApprovalValue | undefined;
    put(key: SandboxApprovalKey): void;
    clear(): void;
    size(): number;
}
//# sourceMappingURL=sandbox-approval-store.d.ts.map