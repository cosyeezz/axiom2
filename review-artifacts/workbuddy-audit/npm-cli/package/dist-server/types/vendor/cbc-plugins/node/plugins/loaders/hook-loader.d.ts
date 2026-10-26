import { Logger } from '@celljs/core';
import { HookConfig } from '../../../../../node/hooks/hook-protocol.js';
import { PluginEnvironmentContext } from '../plugin-environment';
import { PluginOptionsStorage } from '../plugin-options-storage';
import { PluginExtensionType, PluginHooksConfig } from '../plugin-protocol';
/**
 * Hook 扩展加载器
 * 从扩展目录中加载 hooks 配置
 * 支持配置路径和默认扫描的合并
 */
export declare class HookExtensionLoader {
    readonly type = PluginExtensionType.Hook;
    protected readonly logger: Logger;
    protected readonly pluginOptionsStorage?: PluginOptionsStorage;
    protected init(): void;
    /**
     * 加载 hooks 配置
     * 如果提供了 hooksConfig 配置，则加载指定配置；否则默认扫描 hooks.json 文件
     * 两种方式的结果会被合并
     * @param extensionDir 扩展目录路径
     * @param source 来源
     * @param hooksConfig 可选的 hooks 配置，可以是文件路径或直接的配置对象
     * @returns Hook 配置对象，键为事件名，值为 HookConfig 数组
     */
    load(extensionDir: string, source: string, hooksConfig?: PluginHooksConfig, pluginEnvironment?: PluginEnvironmentContext): Promise<Record<string, HookConfig[]>>;
    /**
     * 从配置加载 hooks
     * @param extensionDir 扩展目录路径
     * @param source 来源
     * @param hooksConfig hooks 配置，可以是文件路径或直接的配置对象
     * @returns Hook 配置对象
     */
    private loadFromConfig;
    private mergeHooks;
    private pathExists;
    /**
     * 从文件加载 hooks
     * @param filePath 文件路径
     * @param source 来源
     * @returns Hook 配置对象
     */
    private loadFromFile;
    /**
     * 验证 hooks 配置格式是否正确
     * @param config 配置对象
     * @returns 是否为有效的 hooks 配置
     */
    private isValidHooksConfig;
    /**
     * 验证单个 HookConfig 是否有效
     * @param config HookConfig 对象
     * @returns 是否为有效的 HookConfig
     */
    private isValidHookConfig;
}
//# sourceMappingURL=hook-loader.d.ts.map