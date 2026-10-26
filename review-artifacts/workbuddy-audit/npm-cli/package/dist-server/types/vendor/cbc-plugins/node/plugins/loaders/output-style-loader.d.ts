import { Logger } from '@celljs/core';
import { PluginErrorCollector, PluginExtensionType, PluginOutputStyleEntry } from '../plugin-protocol';
/**
 * Output Style 扩展加载器
 * 从扩展目录的 output-styles 子目录中加载 output style 配置
 * 支持配置路径和默认扫描的合并
 */
export declare class OutputStyleExtensionLoader {
    readonly type = PluginExtensionType.OutputStyle;
    protected readonly logger: Logger;
    protected readonly errorCollector: PluginErrorCollector;
    protected init(): void;
    /**
     * 加载 output styles
     * 如果提供了 outputStylePaths 配置，则加载指定路径；否则默认扫描 output-styles 目录
     * 两种方式的结果会被合并，去重并命名空间化
     * @param extensionDir 扩展目录路径
     * @param extensionName 扩展名称（用于命名空间化）
     * @param outputStylePaths 可选的 output style 路径配置数组，相对于 extensionDir
     * @returns PluginOutputStyleEntry 数组
     */
    load(extensionDir: string, extensionName: string, outputStylePaths?: string[]): Promise<PluginOutputStyleEntry[]>;
    /**
     * 从指定的 output style 路径加载
     * @param extensionDir 扩展目录路径
     * @param extensionName 扩展名称（用于命名空间化）
     * @param outputStylePaths output style 路径配置数组
     * @param loadedPaths 已加载的路径集合，用于去重
     * @returns PluginOutputStyleEntry 数组
     */
    private loadFromPaths;
    private pathExists;
    /**
     * 扫描 output-styles 目录并加载所有 Markdown 文件
     * @param baseDir 基础目录路径
     * @param extensionName 扩展名称（用于命名空间化）
     * @param loadedPaths 已加载的路径集合
     * @returns PluginOutputStyleEntry 数组
     */
    private scanOutputStylesDirectory;
    /**
     * 解析单个 output style 文件
     * @param filePath 文件路径
     * @param extensionName 扩展名称（用于命名空间化）
     * @param styleName 可选的样式名称（来自目录或文件名）
     * @returns PluginOutputStyleEntry | undefined
     */
    private parseOutputStyleFile;
}
//# sourceMappingURL=output-style-loader.d.ts.map