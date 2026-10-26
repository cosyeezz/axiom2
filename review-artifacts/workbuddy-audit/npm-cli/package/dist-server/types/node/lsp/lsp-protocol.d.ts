/**
 * LSP 协议类型和接口定义
 */
import type { LspServerConfig } from '../../vendor/cbc-plugins/node/index.js';
/**
 * LSP 服务器状态
 */
export declare enum LSPServerStatus {
    /** 未启动 */
    Stopped = "stopped",
    /** 启动中 */
    Starting = "starting",
    /** 运行中 */
    Running = "running",
    /** 已崩溃 */
    Crashed = "crashed",
    /** 不可用 */
    Unavailable = "unavailable"
}
/**
 * LSP 服务器实例信息
 */
export interface LSPServerInstance {
    /** 语言 ID */
    languageId: string;
    /** 服务器配置 */
    config: LspServerConfig;
    /** 服务器状态 */
    status: LSPServerStatus;
    /** 客户端实例 */
    client?: LSPClient;
    /** 重启次数 */
    restartCount: number;
    /** 插件名称 */
    pluginName: string;
    /** 市场名称 */
    marketplaceName: string;
}
/**
 * LSP 位置信息 (0-based)
 */
export interface LSPPosition {
    line: number;
    character: number;
}
/**
 * LSP 范围信息
 */
export interface LSPRange {
    start: LSPPosition;
    end: LSPPosition;
}
/**
 * LSP 位置链接
 */
export interface LSPLocation {
    uri: string;
    range: LSPRange;
}
/**
 * LSP 符号类型
 */
export declare enum LSPSymbolKind {
    File = 1,
    Module = 2,
    Namespace = 3,
    Package = 4,
    Class = 5,
    Method = 6,
    Property = 7,
    Field = 8,
    Constructor = 9,
    Enum = 10,
    Interface = 11,
    Function = 12,
    Variable = 13,
    Constant = 14,
    String = 15,
    Number = 16,
    Boolean = 17,
    Array = 18,
    Object = 19,
    Key = 20,
    Null = 21,
    EnumMember = 22,
    Struct = 23,
    Event = 24,
    Operator = 25,
    TypeParameter = 26
}
/**
 * LSP 符号信息
 */
export interface LSPSymbolInformation {
    name: string;
    kind: LSPSymbolKind;
    location: LSPLocation;
    containerName?: string;
}
/**
 * LSP 文档符号
 */
export interface LSPDocumentSymbol {
    name: string;
    kind: LSPSymbolKind;
    range: LSPRange;
    selectionRange: LSPRange;
    detail?: string;
    children?: LSPDocumentSymbol[];
}
/**
 * LSP Hover 信息
 */
export interface LSPHover {
    contents: string | {
        language: string;
        value: string;
    };
    range?: LSPRange;
}
/**
 * LSP 调用层次结构项
 */
export interface LSPCallHierarchyItem {
    name: string;
    kind: LSPSymbolKind;
    uri: string;
    range: LSPRange;
    selectionRange: LSPRange;
    detail?: string;
}
/**
 * LSP 调用层次结构入站调用
 */
export interface LSPCallHierarchyIncomingCall {
    from: LSPCallHierarchyItem;
    fromRanges: LSPRange[];
}
/**
 * LSP 调用层次结构出站调用
 */
export interface LSPCallHierarchyOutgoingCall {
    to: LSPCallHierarchyItem;
    fromRanges: LSPRange[];
}
/**
 * LSP 客户端接口
 */
export declare const LSPClient: unique symbol;
export interface LSPClient {
    init(config: LspServerConfig, languageId: string): void;
    /**
     * 初始化 LSP 客户端并启动服务器
     */
    initialize(): Promise<void>;
    /**
     * 关闭 LSP 服务器
     */
    shutdown(): Promise<void>;
    /**
     * 跳转到定义
     */
    goToDefinition(uri: string, position: LSPPosition): Promise<LSPLocation[]>;
    /**
     * 查找引用
     */
    findReferences(uri: string, position: LSPPosition): Promise<LSPLocation[]>;
    /**
     * 获取 hover 信息
     */
    hover(uri: string, position: LSPPosition): Promise<LSPHover | null>;
    /**
     * 获取文档符号
     */
    documentSymbol(uri: string): Promise<LSPSymbolInformation[] | LSPDocumentSymbol[]>;
    /**
     * 工作区符号搜索
     */
    workspaceSymbol(query: string): Promise<LSPSymbolInformation[]>;
    /**
     * 跳转到实现
     */
    goToImplementation(uri: string, position: LSPPosition): Promise<LSPLocation[]>;
    /**
     * 跳转到类型定义
     */
    goToTypeDefinition(uri: string, position: LSPPosition): Promise<LSPLocation[]>;
    /**
     * 获取代码补全
     */
    completion(uri: string, position: LSPPosition): Promise<any[]>;
    /**
     * 准备调用层次结构
     */
    prepareCallHierarchy(uri: string, position: LSPPosition): Promise<LSPCallHierarchyItem[]>;
    /**
     * 获取入站调用
     */
    incomingCalls(item: LSPCallHierarchyItem): Promise<LSPCallHierarchyIncomingCall[]>;
    /**
     * 获取出站调用
     */
    outgoingCalls(item: LSPCallHierarchyItem): Promise<LSPCallHierarchyOutgoingCall[]>;
    /**
     * 检查服务器是否正在运行
     */
    isRunning(): boolean;
}
/**
 * LSP Manager 接口
 */
export declare const LSPManager: unique symbol;
export interface LSPManager {
    /**
     * 注册 LSP 服务器配置
     */
    registerServers(lspConfigs: Record<string, LspServerConfig>, pluginName: string, marketplaceName: string): void;
    /**
     * 根据文件路径获取对应的 LSP 客户端
     */
    getClientForFile(filePath: string): Promise<LSPClient | null>;
    /**
     * 获取所有已注册的语言 ID
     */
    getRegisteredLanguages(): string[];
    /**
     * 关闭所有 LSP 服务器
     */
    shutdownAll(): Promise<void>;
    /** Replace plugin-provided LSP registrations from the current active snapshot. */
    reloadPluginServers?(): Promise<void>;
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
