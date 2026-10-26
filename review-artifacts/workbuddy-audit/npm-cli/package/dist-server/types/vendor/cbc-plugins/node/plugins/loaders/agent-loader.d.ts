import { Logger } from '@celljs/core';
import { Agent } from '@genie/product';
import { PluginEnvironmentContext } from '../plugin-environment';
import { PluginErrorCollector, PluginExtensionType } from '../plugin-protocol';
/**
 * Agent 扩展加载器
 * 从扩展目录的 agents 子目录中加载 agent 配置
 * 支持配置路径和默认扫描的合并
 */
export declare class AgentExtensionLoader {
    readonly type = PluginExtensionType.Agent;
    protected readonly logger: Logger;
    protected readonly errorCollector: PluginErrorCollector;
    protected init(): void;
    /**
     * 加载 agents
     * 如果提供了 agentPaths 配置，则加载指定路径；否则默认扫描 agents 目录
     * 两种方式的结果会被合并，并通过路径去重避免重复加载
     * @param extensionDir 扩展目录路径
     * @param extensionName 扩展名称（用于标记）
     * @param agentPaths 可选的 agent 路径配置数组，相对于 extensionDir
     * @returns Agent 数组
     */
    load(extensionDir: string, extensionName: string, agentPaths?: string[], pluginEnvironment?: PluginEnvironmentContext): Promise<Agent[]>;
    /**
     * 从指定的 agent 路径加载
     * @param extensionDir 扩展目录路径
     * @param extensionName 扩展名称
     * @param agentPaths agent 路径配置数组
     * @param loadedPaths 已加载的路径集合，用于去重
     * @returns Agent 数组
     */
    private loadFromPaths;
    private pathExists;
    /**
     * 递归枚举插件 agents 目录下的 .md 文件（走 data-fs seam，注入卷可见）。
     * 深度上限防御异常插件树；软链条目用 stat 归类，与 DirectoryScanUtils 一致。
     */
    private scanMdFiles;
    private scanAgentsDirectory;
    private parseAgentFile;
    private generateSourceLabel;
}
//# sourceMappingURL=agent-loader.d.ts.map