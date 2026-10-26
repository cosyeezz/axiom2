/**
 * LSP 服务器管理器
 * 负责 LSP 服务器的注册、启动、管理和关闭
 */
import { type LspServerConfig, PluginManager } from '../../vendor/cbc-plugins/node/index.js';
import { Workspace } from '@genie/runtime';
import { Logger } from '@genie/telemetry';
import { LSPClient as ILSPClient, LSPManager as ILSPManager, LSPServerInstance } from './lsp-protocol';
export declare class LSPManagerImpl implements ILSPManager {
    protected readonly logger: Logger;
    protected readonly workspace: Workspace;
    protected readonly pluginManager: PluginManager;
    /** 语言 ID 到服务器配置的映射 */
    private languageConfigs;
    /** 是否已加载插件的 LSP 配置 */
    private hasLoadedPlugins;
    /** 文件扩展名到语言 ID 的映射 */
    private extensionToLanguage;
    /** 正在启动的服务器Promise，用于防止并发启动同一服务器 */
    private startingServers;
    /** Serialize explicit plugin reloads so teardown and rebuild cannot overlap. */
    private reloadPluginServersTail;
    /** exit 清理钩子仅在首个 LSP 子进程真实启动时注册（见 startServerSafe）。 */
    private exitHookRegistered;
    protected init(): void;
    private ensureExitHook;
    /**
     * 确保已加载所有插件的 LSP 配置
     */
    private ensurePluginsLoaded;
    /**
     * 注册 LSP 服务器配置
     */
    registerServers(lspConfigs: Record<string, LspServerConfig>, pluginName: string, marketplaceName: string): void;
    /**
     * 验证配置
     */
    private validateConfig;
    /**
     * 根据文件路径获取对应的 LSP 客户端
     */
    getClientForFile(filePath: string): Promise<ILSPClient | null>;
    /**
     * 后台启动服务器（不等待结果，用于注册时立即启动）
     */
    private startServerInBackground;
    /**
     * 安全启动服务器（确保单例，防止并发启动）
     */
    private startServerSafe;
    /**
     * 启动服务器
     */
    private startServer;
    /**
     * 检查是否应该重启
     */
    private shouldRestart;
    /**
     * 安排重启
     */
    private scheduleRestart;
    /**
     * 获取所有已注册的语言 ID
     */
    getRegisteredLanguages(): string[];
    /**
     * 关闭所有 LSP 服务器
     */
    shutdownAll(): Promise<void>;
    reloadPluginServers(): Promise<void>;
    private drainStartingServers;
    /**
     * 同步关闭所有服务器(用于进程退出时)
     */
    private shutdownAllSync;
    /**
     * 获取服务器实例信息(用于调试)
     */
    getServerInstance(languageId: string): LSPServerInstance | undefined;
    /**
     * 预热指定语言的 LSP 服务器（可选，用于提前启动常用语言）
     * @param languageIds 要预热的语言 ID 列表，为空则预热所有已注册语言
     */
    warmup(languageIds?: string[]): Promise<void>;
    /**
     * 检查指定语言的 LSP 服务器是否已启动
     */
    isServerRunning(languageId: string): boolean;
}
