import { Logger } from '@celljs/core';
import { PromptRenderer } from '../../vendor/cbc-core/node/index.js';
import { PluginManager } from '../../vendor/cbc-plugins/node/index.js';
import { ProductManager } from '@genie/product';
import { OutputStyle, OutputStyleManager } from './output-style-protocol';
export declare class OutputStyleManagerImpl implements OutputStyleManager {
    protected readonly logger: Logger;
    protected readonly productManager: ProductManager;
    protected readonly promptRenderer: PromptRenderer;
    protected readonly pluginManager?: PluginManager;
    private initialized;
    private cachedAllOutputStyles;
    private cachedForcedOutputStyle?;
    /** initialize 握手快照的 in-flight promise；避免并发调用重复读 product 配置。 */
    private initializeSnapshotPromise?;
    /** 后台预热 `init()` 的 promise（`getInitializeSnapshot` 触发后 fire-and-forget）。 */
    private backgroundInitPromise?;
    initialize(): void;
    init(): Promise<void>;
    reload(): Promise<void>;
    /**
     * initialize 握手专用的**快速快照**：只等 `productManager.waitConfiguration()`，
     * 跳过 fs 目录遍历与插件加载。同时启动后台完整 init（若尚未启动），让首个 run
     * 通过 `getOutputStyleByName` 走进 `getAllOutputStyles()` 时能直接命中缓存。
     *
     * 之所以不能简单返回 `getAllOutputStyles()`：后者首次会同步 await `loadAllOutputStyles()`
     * —— 这正是要从 initialize 关键路径剥离的耗时（实测约 23ms，主要是工作目录树 access
     * 及插件 activePlugins 迭代）。快照路径把这段耗时挪到后台，initialize 握手立刻返回。
     */
    getInitializeSnapshot(): Promise<OutputStyle[]>;
    /**
     * Get all output styles (cached)
     * Returns array of output styles including built-in and custom styles
     * Child directories take precedence - duplicates by name are ignored
     */
    getAllOutputStyles(): Promise<OutputStyle[]>;
    /**
     * Parse markdown content to extract output style information
     */
    parseOutputStyleContent(content: string, filePath: string): OutputStyle;
    /**
     * Get output style by name
     * Returns the first matching style (case-insensitive)
     *
     * 内置样式的 content 在此**按需懒渲染**：加载列表时只存 `instructionsTemplate`，
     * 首次通过本方法取用时才 `promptRenderer.render` 并写回 `content` 缓存，后续命中直接返回。
     */
    getOutputStyleByName(name: string): Promise<OutputStyle | undefined>;
    getForcedOutputStyle(): Promise<OutputStyle | undefined>;
    /**
     * Load built-in output styles from product configuration.
     *
     * 只提取 name/description/模板名，**不预渲染 instructions 模板**。渲染
     * （`promptRenderer.render`）成本较高，而列表消费者（`initialize` 握手的
     * `available_output_styles`、样式选择面板）只需要 name/description。真正的 content
     * 由 `getOutputStyleByName` 在 run 时按需懒渲染（见该方法与 `instructionsTemplate` 注释）。
     */
    private loadBuiltInOutputStyles;
    /**
     * Load built-in, project, user and plugin output styles.
     * For nested project styles, the directory closest to cwd wins.
     */
    private loadAllOutputStyles;
    protected getManagedOutputStyleDirectory(): string | undefined;
    private loadOutputStylesFromDirectory;
    /**
     * Legacy method for backward compatibility
     * @deprecated Use getAllOutputStyles instead
     */
    getProjectOutputStyles(): Promise<OutputStyle[]>;
    /**
     * Load output styles from enabled plugins
     */
    private loadPluginOutputStyles;
}
