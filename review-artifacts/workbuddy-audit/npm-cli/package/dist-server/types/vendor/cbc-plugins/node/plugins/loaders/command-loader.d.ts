import { Logger } from '@celljs/core';
import { type DataFs } from '../../../../../node/data-fs/index.js';
import { Command, type ProductConfiguration } from '@genie/product';
import { PluginEnvironmentContext } from '../plugin-environment';
import { PluginErrorCollector, PluginExtensionType } from '../plugin-protocol';
/**
 * Command 扩展加载器
 * 从扩展目录的 commands 子目录中加载 slash command 配置
 * 支持配置路径和默认扫描的合并
 */
export declare class CommandExtensionLoader {
    /** Hosts may decorate reads within one catalog operation; default CLI resolution stays dynamic. */
    protected get filesystem(): DataFs;
    readonly type = PluginExtensionType.Command;
    protected readonly logger: Logger;
    protected readonly errorCollector: PluginErrorCollector;
    protected init(): void;
    /** Embedding hosts can supply the Product belonging to their own assembly. */
    protected getProductConfiguration(): Pick<ProductConfiguration, 'models'> | undefined;
    /**
     * 加载 commands
     * 如果提供了 commandPaths 配置，则加载指定路径；否则默认扫描 commands 目录
     * 两种方式的结果会被合并，并通过路径去重避免重复加载
     * @param extensionDir 扩展目录路径
     * @param source 来源
     * @param commandPaths 可选的 command 路径配置数组，相对于 extensionDir
     * @returns Command 数组
     */
    load(extensionDir: string, source: string, commandPaths?: string[], pluginEnvironment?: PluginEnvironmentContext): Promise<Command[]>;
    /**
     * 从指定的 command 路径加载
     * @param extensionDir 扩展目录路径
     * @param source 来源
     * @param commandPaths command 路径配置数组
     * @param loadedPaths 已加载的路径集合，用于去重
     * @returns Command 数组
     */
    private loadFromPaths;
    private pathExists;
    private scanCommandsDirectory;
    private parseCommandFile;
}
//# sourceMappingURL=command-loader.d.ts.map