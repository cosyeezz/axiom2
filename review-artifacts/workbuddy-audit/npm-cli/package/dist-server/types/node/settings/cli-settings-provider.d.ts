import { Logger } from '@celljs/core';
import { CliProvider } from '../cli/cli-protocol';
import { CliRuntimeOptions } from '../cli/cli-runtime-options';
import { StartupProfiler } from '../telemetry/startup-profiler-protocol';
import { Settings } from './settings-protocol';
/**
 * CLI Settings Provider
 * 负责从 CLI 参数中解析和加载 settings
 * 独立管理 CLI scope 的 settings,不依赖 SettingsManager
 */
export declare class CliSettingsProvider {
    protected readonly logger: Logger;
    protected readonly cliProvider: CliProvider;
    protected readonly cliRuntimeOptions: CliRuntimeOptions;
    protected get startupProfiler(): StartupProfiler;
    private cliSettings;
    private deferred;
    /**
     * 加载操作串行队列：把首轮加载与后续每次 reload 排成一条链，保证任意时刻
     * 只有一个加载在跑。否则冷启动时 subscribe 的种子加载与紧随其后的
     * CliDispatcher `set()` 会并发执行 `loadCliSettings`，交错写 `cliSettings`
     * 造成快照错乱（你指出的竞态）。
     */
    private loadChain;
    init(): void;
    /**
     * 执行一次加载：解析 argv → 构建快照 → 原子替换。
     *
     * @param isFirst 是否为订阅瞬间的首轮加载（负责 profiler 计时与 resolve
     *   deferred，使 getSettings() 的等待者放行）。
     */
    private runLoad;
    /**
     * 获取 CLI settings
     */
    getSettings(): Promise<Settings>;
    /**
     * Wait until every CLI-options reload queued so far has committed its
     * snapshot. Startup/prewarm activation uses this as a simple barrier after
     * `CliRuntimeOptions.set()`; `loadChain` already serializes those reloads.
     */
    waitUntilSettled(): Promise<void>;
    /**
     * 设置单个 CLI setting（运行时修改，仅当前进程生效）
     */
    set<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>;
    /**
     * 从当前 `process.argv` 解析 CLI settings，构建并返回一个**全新**的快照对象。
     *
     * 纯函数式：不触碰 `this.cliSettings`，由调用方（runLoad）原子替换，
     * 从而天然支持串行 reload 而无快照错乱。
     *
     * 预热（prewarm）背景：standby 阶段首轮加载时 `process.argv` 还是
     * `[node, entry, --prewarm, ...]`，解析不到真实的 `--model` / `--effort` /
     * `--settings`；activate set() 触发的再次加载会读到重写后的真实 argv。
     */
    private buildCliSettings;
    /**
     * 解析 --settings 参数
     * 支持两种格式:
     * 1. JSON 字符串: '{"model": "sonnet", "theme": "dark"}'
     * 2. 文件路径: ./settings.json 或 ~/settings.json
     */
    private parseSettingsOption;
    /**
     * 判断字符串是否看起来像 JSON
     */
    private looksLikeJson;
    /**
     * 解析 JSON 字符串
     */
    private parseJsonString;
    /**
     * 从文件读取 settings
     * - 支持相对路径(基于当前执行目录)
     * - 支持绝对路径
     * - 支持 ~ 开头的用户目录路径
     */
    private readSettingsFile;
}
