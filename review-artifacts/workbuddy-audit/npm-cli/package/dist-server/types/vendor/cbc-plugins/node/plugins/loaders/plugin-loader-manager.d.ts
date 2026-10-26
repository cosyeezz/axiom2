import { Logger } from '@celljs/core';
import { CliRuntimeOptions } from '../../../../../node/cli/cli-runtime-options.js';
import { McpConfig } from '../../../../../node/mcp/index.js';
import { Command, Skill } from '@genie/product';
import { PluginOptionsStorage } from '../plugin-options-storage';
import { PluginComponents, PluginErrorCollector, PluginInfo } from '../plugin-protocol';
import { AgentExtensionLoader } from './agent-loader';
import { CommandExtensionLoader } from './command-loader';
import { HookExtensionLoader } from './hook-loader';
import { LSPExtensionLoader } from './lsp-loader';
import { MCPExtensionLoader } from './mcp-loader';
import { OutputStyleExtensionLoader } from './output-style-loader';
import { SkillExtensionLoader } from './skill-loader';
/**
 * 插件加载器管理器
 * 统一协调各类型扩展加载器，根据pluginInfo对象的配置智能加载扩展
 * 内部智能合并配置加载和文件扫描的结果
 */
export declare class PluginLoaderManager {
    protected readonly logger: Logger;
    protected readonly errorCollector: PluginErrorCollector;
    protected readonly agentLoader: AgentExtensionLoader;
    protected readonly commandLoader: CommandExtensionLoader;
    protected readonly skillLoader: SkillExtensionLoader;
    protected readonly hookLoader: HookExtensionLoader;
    protected readonly mcpLoader: MCPExtensionLoader;
    protected readonly lspLoader: LSPExtensionLoader;
    protected readonly outputStyleLoader: OutputStyleExtensionLoader;
    protected readonly pluginOptionsStorage?: PluginOptionsStorage;
    protected readonly cliRuntimeOptions: CliRuntimeOptions;
    protected init(): void;
    /**
     * 归一化路径配置：仅保留字符串路径，过滤掉非字符串项。
     *
     * 背景：plugin-manager 的 enrichPluginInfo 出于 REST 展示目的，会把
     * `{ name, description }` 对象写入同一个 PluginInfo 的 skills/commands 字段
     * （契约本应为路径字符串）。这些展示元数据并非可加载的路径，若直接透传给
     * 各 loader 的 `join(extensionDir, path)` 会抛 ERR_INVALID_ARG_TYPE，进而被
     * 上层 catch 静默吞掉，最终降级为「0 个技能/命令」。这里在消费边界做归一化，
     * 把非字符串项剔除；当过滤后为空时返回 undefined，使 loader 回退到默认目录扫描。
     */
    private normalizePathConfig;
    private createPluginEnvironment;
    private loadPluginCommandsWithEnvironment;
    /**
     * Load only slash commands from one already-resolved Plugin path. This is
     * the runtime-parity boundary used by pre-session management discovery; it
     * deliberately does not inspect hooks, MCP bundles, LSP or other Plugin
     * components.
     */
    loadPluginCommands(pluginInfo: PluginInfo, pluginPath: string, projectDir: string): Promise<Command[]>;
    /** Read eligible command/Skill resources without loading MCP, hooks or LSP. */
    loadPluginCommandsAndSkills(pluginInfo: PluginInfo, pluginPath: string, projectDir: string): Promise<{
        commands: Command[];
        skills: Skill[];
    }>;
    /**
     * Load only MCP declarations from one already-resolved Plugin path.
     *
     * Resource discovery uses this narrow boundary to describe Plugin MCP to
     * the Harness-owned connection plane without activating the rest of the
     * Plugin runtime or publishing the descriptors into this process's MCP
     * manager. An ordinary Agent runtime can still load and connect its own
     * Plugin MCP through {@link loadPluginComponents} when strict MCP config is
     * disabled.
     */
    loadPluginMcpServers(pluginInfo: PluginInfo, pluginPath: string, projectDir: string, environment: Readonly<NodeJS.ProcessEnv>): Promise<Record<string, McpConfig>>;
    /**
     * 从插件信息加载所有组件
     * 根据pluginInfo对象中的配置字段决定加载哪些扩展
     * 各加载器内部会智能合并配置和文件扫描的结果
     *
     * @param pluginInfo 插件信息对象，包含name、description及agents/commands/skills/hooks/mcpServers等配置
     * @param pluginPath 插件安装路径
     * @returns PluginComponents 包含所有加载的扩展组件
     */
    loadPluginComponents(pluginInfo: PluginInfo, pluginPath: string): Promise<PluginComponents>;
}
//# sourceMappingURL=plugin-loader-manager.d.ts.map