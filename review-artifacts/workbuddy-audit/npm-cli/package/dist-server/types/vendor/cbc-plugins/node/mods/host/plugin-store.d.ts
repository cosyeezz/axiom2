/** The host supplies its existing cross-process lock, without a host dependency. */
export interface PluginStoreLocks {
    acquireFileLock(name: string): Promise<() => Promise<void>>;
}
export type PluginStoreValidator = (state: Record<string, unknown>) => void;
/** Stable machine-readable code for {@link PluginStoreLegacyOwnershipError}. */
export declare const PLUGIN_STORE_LEGACY_OWNERSHIP_AMBIGUOUS = "MOD_STORE_LEGACY_OWNERSHIP_AMBIGUOUS";
/** `adopt` copies the legacy file into the new store; `fresh` starts empty and leaves it alone. */
export type PluginStoreLegacyResolution = 'adopt' | 'fresh';
/**
 * A pre-v2 store file exists whose owner cannot be determined.
 *
 * The legacy encoder replaced every character outside `[A-Za-z0-9._-]` with `_`,
 * so `demo/a`, `demo a` and `demo_a` all wrote `demo_a.json`. The file is never
 * read, moved or overwritten on a guess. Until the owner is chosen explicitly
 * (`PluginStore.resolveLegacyOwnership`) every operation on that Mod fails with
 * this error, so a new v2 write cannot silently shadow the old state.
 */
export declare class PluginStoreLegacyOwnershipError extends Error {
    readonly plugin: string;
    readonly legacyFile: string;
    readonly storeFile: string;
    readonly code = "MOD_STORE_LEGACY_OWNERSHIP_AMBIGUOUS";
    constructor(plugin: string, legacyFile: string, storeFile: string);
}
export declare function isPluginStoreLegacyOwnershipError(error: unknown): error is PluginStoreLegacyOwnershipError;
/**
 * `$.store` 的后端：**一个 plugin 一份**，按 plugin 名分文件。
 *
 * 隔离是刚需而不是洁癖：`$.store` 的键由 mod 自己命名，两个 mod 撞上同名键（`state`
 * / `seen` 这类几乎必然撞）就会互相覆盖，而这种串台在运行时看起来像「我写进去的值
 * 莫名变了」，极难查。所以 core 拿到 `origin.plugin` 后各写各的文件。
 *
 * 落盘用 temp-then-rename：写一半被 kill 不会留下半个 JSON 让下次启动读崩。
 */
export declare class PluginStore {
    private readonly dir?;
    private readonly locks?;
    private readonly memory;
    private readonly memoryTails;
    /** @param dir 落盘目录；缺省表示只在进程内存活。 */
    constructor(dir?: string | undefined, locks?: PluginStoreLocks | undefined);
    private fileOf;
    private read;
    private write;
    private transaction;
    get(plugin: string, key: string, validate?: PluginStoreValidator): Promise<unknown>;
    set(plugin: string, key: string, value: unknown, validate?: PluginStoreValidator): Promise<void>;
    delete(plugin: string, key: string, validate?: PluginStoreValidator): Promise<void>;
    keys(plugin: string, validate?: PluginStoreValidator): Promise<string[]>;
    /**
     * Explicit, operator-driven answer to {@link PluginStoreLegacyOwnershipError}.
     * Commits the v2 file under the same lock and never touches the legacy file.
     * If a v2 file already exists, ownership was settled earlier and it is kept as is.
     */
    resolveLegacyOwnership(plugin: string, resolution: PluginStoreLegacyResolution, validate?: PluginStoreValidator): Promise<void>;
}
//# sourceMappingURL=plugin-store.d.ts.map