import { SettingsManager } from '../settings/settings-protocol';
import { McpConfigManager, McpPermissionsManager, McpScope } from './mcp-protocol';
export declare class McpPermissionsManagerImpl implements McpPermissionsManager {
    protected readonly settingsManager: SettingsManager;
    protected readonly mcpConfigManager: McpConfigManager;
    /**
     * 获取相关的 Settings 配置
     * 读取 CLI 和 PROJECT_LOCAL 作用域的设置并合并，CLI 作用域优先级更高
     * @returns MCP 相关的设置配置
     */
    private getMcpSettings;
    /**
     * 检查指定的 MCP 服务器是否被允许连接
     *
     * 仅 PROJECT 作用域的服务器需要用户批准，因为它们来自项目目录中的 .mcp.json，
     * 可能来自不受信任的 git 仓库。其他作用域的服务器来源如下，均为可信来源：
     * - INTERNAL: 内部核心服务器
     * - SDK: IDE/SDK 注册的服务器
     * - DYNAMIC: 通过 --mcp-config CLI 参数显式传入
     * - LOCAL: 用户本地配置文件
     * - USER: 用户全局配置
     * - PLUGIN: 用户安装的插件
     *
     * @param serverName 服务器名称
     * @param scope 服务器所在的作用域。当提供时，可以跳过 PROJECT 配置查找
     * @returns 是否被允许连接
     */
    isAllowed(serverName: string, scope?: McpScope): Promise<boolean>;
    /**
     * 批准指定的 MCP 服务器
     * 修改 enabledMcpjsonServers 设置
     * @param serverNames 服务器名称数组
     */
    approve(serverNames: string[]): Promise<void>;
    /**
     * 拒绝指定的 MCP 服务器
     * 修改 disabledMcpjsonServers 设置
     * @param serverNames 服务器名称数组
     */
    deny(serverNames: string[]): Promise<void>;
    /**
     * 批准所有项目 MCP 服务器
     * 直接修改 enableAllProjectMcpServers 选项
     */
    approveAll(): Promise<void>;
    /**
     * 获取所有需要确认的项目作用域服务器名称
     * 即 enableAllProjectMcpServers 不为 true 且不在 enabledMcpjsonServers 和 disabledMcpjsonServers 中的项目作用域服务器
     * @returns 需要确认的项目作用域服务器名称数组
     */
    getServersNeedingConfirmation(): Promise<string[]>;
}
