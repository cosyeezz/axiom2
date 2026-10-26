import { Emitter, Logger } from '@celljs/core';
import { HookInput } from '../../vendor/cbc-core/node/index.js';
import { Mutex } from 'async-mutex';
import { FileLockService } from '../lock/lock-protocol';
import { CliSettingSourcesProvider } from './cli-setting-sources-provider';
import { CliSettingsProvider } from './cli-settings-provider';
import { Settings, SettingsManager, SettingsScope, SettingsUpdateResult, UserSettingsLayerMutationResult, UserSettingsLayerSnapshot } from './settings-protocol';
export declare class SettingsManagerImpl implements SettingsManager {
    /**
     * Optional host-owned ConfigChange dispatch after a file commit. The host
     * owns completion and shutdown; a rejected hook never rolls back the write.
     * When absent, the CLI continues to use its registered HookManager.
     */
    configChangeHook?: (input: HookInput) => Promise<void>;
    protected readonly logger: Logger;
    protected readonly cliSettingsProvider: CliSettingsProvider;
    protected readonly cliSettingSourcesProvider: CliSettingSourcesProvider;
    protected readonly fileLockService: FileLockService;
    protected readonly onDidChangeEmitter: Emitter<void>;
    readonly onDidChange: import("@celljs/core").Event<void>;
    private readonly files;
    /** Invalidates every in-flight file read when all settings caches are cleared. */
    protected cacheGeneration: number;
    /** Invalidates only the selected scope while leaving sibling caches intact. */
    protected readonly scopeCacheGenerations: Partial<Record<SettingsScope, number>>;
    /** 上次 fire onDidChange 时的 settings 内容指纹，用于抑制自写引发的 watcher 回声。 */
    protected lastNotifiedFingerprint: string | undefined;
    /**
     * 需要按子键合并的设置 key,而不是简单覆盖。
     *
     * 跨 scope 合并语义（详见 `deepMerge`）：
     * - 嵌套对象按子键递归合并；
     * - **数组取并集去重**；
     * - 基本类型按 scope 优先级覆盖（后加载的胜出）。
     *
     * 对 `sandbox` 的影响：`orderedRules` 是分类级完整快照；后加载 scope 的同分类快照
     * 替换前一个 scope 的规则数组，未提供的分类继续沿用低优先级 scope，避免不同 scope
     * 的规则被错误并集或整类丢失。其它 sandbox 子键仍按递归合并处理。
     *
     * 详见 `apps/workbuddy-desktop/docs/security-center.md` 的"跨 scope 合并语义"段落。
     * 修改本数组前请同步评估上述 fail-open / fail-safe 影响。
     */
    protected readonly mergeBySubKeySettings: (keyof Settings)[];
    /**
     * 写路径深合并白名单（set 时按子键合并，而非整体替换）。
     *
     * 与 {@link mergeBySubKeySettings}（读路径跨 scope 合并）不同：这里约束**同一 scope 内**
     * 多次 set 的累加语义。`codebuddy.mainAgent` 的 enabled / allowUnopted / default
     * 由不同入口写入，必须按子键合并。
     */
    protected readonly mergeOnWriteSettings: (keyof Settings)[];
    protected readonly scopeMutexes: Map<SettingsScope, Mutex>;
    private fileState;
    /**
     * 获取或创建 scope 的 mutex
     */
    protected getScopeMutex(scope: SettingsScope): Mutex;
    /**
     * 带锁执行操作，防止并发读写冲突
     */
    protected withLock<T>(scope: SettingsScope, fn: () => Promise<T>): Promise<T>;
    protected mergeSetting(current: any, newValue: any, settingsKey: keyof Settings): void;
    /**
     * 深度合并对象，source 的值会覆盖 target 中的同名属性
     * 数组会合并并去重，嵌套对象会递归合并
     *
     * 注意：数组并集（union）语义对 `sandbox` 等安全相关字段的影响参见
     * {@link mergeBySubKeySettings} 的注释——白名单 fail-open，黑名单 fail-safe。
     */
    protected deepMerge(target: any, source: any): void;
    protected readSettingsWithRetry(scope: SettingsScope, maxRetries?: number, forceFresh?: boolean): Promise<Settings>;
    private readSettingsFromDisk;
    /** Small test seam around the asynchronous read that owns cache population. */
    protected readSettingsFile(filePath: string): Promise<string>;
    get<K extends keyof Settings>(key: K, scope?: SettingsScope): Promise<Settings[K]>;
    set<K extends keyof Settings>(key: K, value: Settings[K], scope?: SettingsScope): Promise<void>;
    remove<K extends keyof Settings>(key: K, values?: Settings[K], scope?: SettingsScope): Promise<void>;
    list(scope?: SettingsScope): Promise<Settings>;
    add<K extends keyof Settings>(key: K, values: Settings[K], scope?: SettingsScope): Promise<void>;
    update<K extends keyof Settings>(key: K, updater: (currentValue: Settings[K]) => Settings[K] | Promise<Settings[K]>, scope?: SettingsScope): Promise<SettingsUpdateResult>;
    readUserConfigLayer(): Promise<UserSettingsLayerSnapshot>;
    mutateUserConfigLayer(updater: (current: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>, expectedVersion?: string | null): Promise<UserSettingsLayerMutationResult>;
    /**
     * 对单个 scope 执行原子的「重新读盘 → 修改 → JSONC 写回」事务。
     *
     * 进程内 mutex 和跨进程文件锁都在 fresh read 之前获取，并一直持有到原子 rename
     * 完成。否则两个进程可以同时基于同一份旧快照修改不同字段，虽然各自的 rename
     * 都是原子的，后写入的一方仍会覆盖先写入的一方。
     */
    private mutateScope;
    private shouldSkipCorruptedScope;
    /**
     * 读取单个 scope 的设置作为「写入基线」，强制绕过 60s 内存缓存重新读盘。
     *
     * set/add/remove 的写入语义是「读 → 改单个 key → 整体回写」。saveInternal →
     * JsonUtils.updateText 会把回写对象当成顶层 key 的权威全集：磁盘上存在但基线对象
     * 里没有的 key 会被删除。若基线来自至多 60s 过期的缓存，而此间其它写入方（或本进程
     * 其它代码路径）已经往盘上新增/修改了字段（典型如 PluginManager 写 enabledPlugins），
     * 这次写入就会用陈旧快照把那些字段回退甚至删除——即偶发的「插件/skill 突然消失」。
     *
     * 因此写路径必须以磁盘最新内容为基线。读路径（get/list）仍走缓存，不受影响。
     */
    private readUserConfigLayerUnlocked;
    private readScopeForWrite;
    private getSettingsLockName;
    /** USER 文件与 daemon 共用 credential lock；其它 scope 保留历史锁及降级语义。 */
    private withSettingsFileLock;
    /**
     * 内部保存方法。
     *
     * 正常写事务已经持有两层锁，传 `lockAlreadyHeld=true` 避免重复获取。保留默认的
     * 自行加锁路径，方便已有直接调用；两条路径最终都会进入 writeSettingsFile，
     * 因而都会在覆盖前验证现有 JSON/JSONC，避免损坏文件被静默替换。
     */
    protected saveInternal(settings: Record<string, any>, scope: SettingsScope, lockAlreadyHeld?: boolean): Promise<boolean>;
    private writeSettingsFile;
    private decodeUserSettings;
    private encodeUserSettings;
    private scheduleUserSettingsMigration;
    private createCredentialFailureReporter;
    /**
     * 外部改动 settings 文件后补发 onDidChange，详见接口注释。
     *
     * 回声抑制：settings 写盘是 temp + rename 的原子写，rename 事件在
     * ConfigWatchService 里不走防抖、会立即触发热更新，因此本进程每次 set/update
     * 都会被 watcher 回声一次。这里比对三个 scope 的内容指纹，与上次 fire 时相同
     * 就不再 fire —— 写盘路径已把新内容写进缓存，回声读到的指纹与之一致。
     */
    notifyExternalChange(): Promise<void>;
    /** 三个 scope 的内容指纹，用于识别 settings 是否真的变了。 */
    protected computeSettingsFingerprint(): Promise<string>;
    /**
     * 清除指定 scope 的缓存，如不指定则清除所有缓存
     * @param scope 要清除缓存的 scope
     */
    clearCache(scope?: SettingsScope): void;
    /**
     * Map cbc's SettingsScope to Claude Code's ConfigChange `source` value.
     */
    private mapScopeToConfigSource;
    /**
     * Fire-and-forget ConfigChange hook dispatch.
     * Skips silently when scope doesn't map to a CC source (e.g. CLI).
     */
    private dispatchConfigChangeHook;
}
