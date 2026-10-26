/**
 * LSP 客户端实现
 * 使用 vscode-languageserver-protocol 和 vscode-jsonrpc 与 LSP 服务器通信
 */
import { Workspace } from '@genie/runtime';
import { Logger } from '@genie/telemetry';
import type { LspServerConfig } from '../../vendor/cbc-plugins/node/index.js';
import { LSPCallHierarchyIncomingCall, LSPCallHierarchyItem, LSPCallHierarchyOutgoingCall, LSPClient as ILSPClient, LSPDocumentSymbol, LSPHover, LSPLocation, LSPPosition, LSPSymbolInformation } from './lsp-protocol';
export declare class LSPClientImpl implements ILSPClient {
    protected readonly workspace: Workspace;
    protected readonly logger: Logger;
    private config;
    private languageId;
    private workspaceRoot;
    private process?;
    private connection?;
    private isInitialized;
    private openedDocuments;
    init(config: LspServerConfig, languageId: string): void;
    /**
     * 初始化 LSP 客户端并启动服务器
     */
    initialize(): Promise<void>;
    /**
     * 启动 stdio 传输方式的 LSP 服务器
     */
    private startServerStdio;
    /**
     * 设置消息处理器 - 处理服务器发起的请求和通知
     */
    private setupMessageHandlers;
    /**
     * 发送 initialize 请求
     */
    private sendInitializeRequest;
    /**
     * 确保文档已打开
     */
    private ensureDocumentOpened;
    /**
     * 转换 LSP Position (0-based) 为内部 Position
     */
    private toLSPPosition;
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
     * 跳转到类型定义
     */
    goToTypeDefinition(uri: string, position: LSPPosition): Promise<LSPLocation[]>;
    /**
     * 获取代码补全
     */
    completion(uri: string, position: LSPPosition): Promise<any[]>;
    /**
     * 规范化位置信息
     */
    private normalizeLocations;
    /**
     * 检查服务器是否正在运行
     */
    isRunning(): boolean;
    /**
     * 关闭 LSP 服务器
     */
    shutdown(): Promise<void>;
    /**
     * 清理资源
     */
    private cleanup;
}
