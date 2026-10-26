import { Logger } from '@celljs/core';
import { SettingsManager } from '../../../../node/settings/settings-protocol.js';
import { PluginUserConfigField } from './plugin-protocol';
/**
 * 插件选项值类型
 */
export type PluginOptionValues = Record<string, string | boolean | number>;
/**
 * 插件选项 Schema（映射到 PluginUserConfigField）
 */
export type PluginOptionSchema = Record<string, PluginUserConfigField>;
/**
 * 插件选项存储服务
 *
 * 实现敏感/非敏感字段的分离存储：
 * - 非敏感字段 → settings.json 的 pluginConfigs[pluginId].options
 * - 敏感字段 → ~/.codebuddy/credentials.json 的 pluginSecrets[pluginId]
 *
 * 参考: Claude Code pluginOptionsStorage.ts
 */
export declare const PluginOptionsStorage: unique symbol;
export interface PluginOptionsStorage {
    /**
     * 加载插件选项值（合并非敏感+敏感）
     * @param pluginId 插件 ID (name@marketplace)
     * @returns 合并后的选项值
     */
    loadOptions(pluginId: string): Promise<PluginOptionValues>;
    /**
     * 保存插件选项值（自动分离敏感/非敏感）
     * @param pluginId 插件 ID
     * @param values 选项值
     * @param schema 选项 schema（用于判断 sensitive）
     */
    saveOptions(pluginId: string, values: PluginOptionValues, schema: PluginOptionSchema): Promise<void>;
    /**
     * 删除插件的所有选项
     * @param pluginId 插件 ID
     */
    deleteOptions(pluginId: string): Promise<void>;
    /**
     * 检查插件是否有已保存的选项
     * @param pluginId 插件 ID
     */
    hasOptions(pluginId: string): Promise<boolean>;
    /**
     * 清除缓存
     */
    clearCache(): void;
    /**
     * 将选项值替换到字符串中的 ${PLUGIN_OPT:key} 占位符
     * @param text 包含占位符的文本
     * @param pluginId 插件 ID
     * @returns 替换后的文本
     */
    substituteOptions(text: string, pluginId: string): Promise<string>;
}
export declare class PluginOptionsStorageImpl implements PluginOptionsStorage {
    protected readonly logger: Logger;
    protected readonly settingsManager?: SettingsManager;
    /** 内存缓存 */
    private cache;
    /** 正在进行的选项加载，用于去重并发读。 */
    private loading;
    /** clear/save/delete 边界后，边界前的读不得回填缓存。 */
    private cacheGeneration;
    protected init(): void;
    loadOptions(pluginId: string): Promise<PluginOptionValues>;
    private loadOptionsUncached;
    saveOptions(pluginId: string, values: PluginOptionValues, schema: PluginOptionSchema): Promise<void>;
    deleteOptions(pluginId: string): Promise<void>;
    hasOptions(pluginId: string): Promise<boolean>;
    clearCache(): void;
    private invalidatePluginCache;
    substituteOptions(text: string, pluginId: string): Promise<string>;
    private loadNonSensitiveOptions;
    private saveNonSensitiveOptions;
    private scrubNonSensitiveKeys;
    private loadSensitiveOptions;
    private saveSensitiveOptions;
    private scrubSensitiveKeys;
    /**
     * 获取 credentials.json 路径
     * ~/.codebuddy/credentials.json
     */
    private getCredentialsPath;
}
//# sourceMappingURL=plugin-options-storage.d.ts.map