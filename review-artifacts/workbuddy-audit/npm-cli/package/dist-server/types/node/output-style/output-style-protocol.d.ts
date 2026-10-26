export declare const OUTPUT_STYLE_DIRNAME = "output-styles";
export declare const OUTPUT_STYLE_PATTERN = "*.md";
export declare const OutputStyleManager: unique symbol;
export interface OutputStyle {
    name: string;
    description: string;
    content: string;
    keepCodingInstructions?: boolean;
    /** 插件样式启用时强制应用，覆盖用户的 outputStyle 设置。 */
    forceForPlugin?: boolean;
    /**
     * 待渲染的 instructions 模板名（仅内置样式携带）。内置样式的 `content` 渲染成本较高
     * （`promptRenderer.render`），而 `initialize` 握手 / 样式选择面板只需要 name/description
     * 列表，不需要 content。因此加载列表时**不预渲染**，把模板名暂存在此，等 `getOutputStyleByName`
     * 真正要用样式内容（run 时应用到 agent instructions）才懒渲染并写回 `content` 缓存。
     * 自定义/插件样式的 content 直接来自文件读取，无渲染成本，不使用本字段。
     */
    instructionsTemplate?: string;
}
export interface OutputStyleManager {
    /** Rebuild cached styles from the current active plugin snapshot. */
    reload?(): Promise<void>;
    /**
     * Get all output styles (built-in + custom)
     * Returns cached data after initialization
     */
    getAllOutputStyles(): Promise<OutputStyle[]>;
    /**
     * initialize 握手专用的**快速快照**：只返回来自 product 配置的内置样式列表
     * （name/description/instructionsTemplate），**不做**任何 fs 扫描 / 插件遍历，
     * 从而避免把工作目录树遍历 + 插件消费拖进 SDK 首次 `initialize` 的关键路径。
     *
     * 自定义 / 插件样式的加载改为**在返回快照之后 fire-and-forget** 由完整
     * `getAllOutputStyles()` 触发；下游首次通过 `getOutputStyleByName` 消费时若尚未
     * 就绪，会自然等待那次后台加载完成 —— 语义等价，仅把耗时从 initialize 握手挪到
     * 首个 prompt 的路径上（run 时本来就要等一堆 await，感知不到）。
     *
     * 语义边界（重要）：本方法**只用于 initialize 握手**回报可选项，不承诺完备性。
     * 需要拿完整列表（TUI 面板 / 按名匹配）请继续用 `getAllOutputStyles()` /
     * `getOutputStyleByName()`。
     */
    getInitializeSnapshot(): Promise<OutputStyle[]>;
    /**
     * Get output style by name
     * Returns the first matching style (case-insensitive)
     */
    getOutputStyleByName(name: string): Promise<OutputStyle | undefined>;
    /** 返回首个由已启用插件强制应用的样式。 */
    getForcedOutputStyle(): Promise<OutputStyle | undefined>;
    /**
     * Get all output styles from current project and parent directories
     * Returns array of output styles ordered from parent to child directories
     * @deprecated Use getAllOutputStyles instead
     */
    getProjectOutputStyles(): Promise<OutputStyle[]>;
    /**
     * Parse markdown content to extract output style information
     */
    parseOutputStyleContent(content: string, filePath: string): OutputStyle;
}
