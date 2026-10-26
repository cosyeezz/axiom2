/**
 * SDK MCP Transport
 *
 * 实现 MCP Transport 接口，通过 control_request/control_response 机制
 * 与 SDK 端的 MCP 服务器通信。
 *
 * 参考: Claude Code SDK MCP Server 架构
 * - 不通过标准的 stdio 或 HTTP 传输层通信
 * - 使用 CLI 程序内部的消息传递机制
 * - 不使用固定超时，通过 AbortSignal 在 transport 关闭时取消所有请求
 */
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
/**
 * SDK MCP Transport 配置选项
 */
export interface SdkMcpTransportOptions {
    /**
     * MCP 服务器名称
     */
    serverName: string;
    /**
     * 发送 MCP 消息的函数
     * 通过 control_request 发送消息到 SDK 端
     */
    sendMcpMessage: (serverName: string, message: JSONRPCMessage, signal?: AbortSignal) => Promise<JSONRPCMessage>;
}
/**
 * SDK MCP Transport 实现
 *
 * 实现了 @modelcontextprotocol/sdk 的 Transport 接口，
 * 将 MCP 协议消息通过 control_request/control_response 机制发送到 SDK 端。
 *
 * 每个 send() 调用创建独立的 AbortController，transport 关闭时取消所有进行中的请求。
 */
export declare class SdkMcpTransport implements Transport {
    private readonly serverName;
    private readonly sendMcpMessage;
    private isClosed;
    private _sessionId?;
    /** 追踪进行中的请求，用于 close() 时取消 */
    private readonly inflightControllers;
    /**
     * 连接关闭时的回调
     */
    onclose?: () => void;
    /**
     * 错误发生时的回调
     */
    onerror?: (error: Error) => void;
    /**
     * 接收到消息时的回调
     */
    onmessage?: (message: JSONRPCMessage) => void;
    /**
     * 会话 ID
     */
    get sessionId(): string | undefined;
    set sessionId(value: string | undefined);
    constructor(options: SdkMcpTransportOptions);
    /**
     * 启动传输层
     *
     * SDK 传输层不需要启动过程，因为它不创建子进程或网络连接。
     * 消息通过 control_request/response 机制直接传递。
     */
    start(): Promise<void>;
    /**
     * 发送 JSON-RPC 消息
     *
     * 通过 sendMcpMessage 函数将消息发送到 SDK 端，
     * SDK 端会返回响应，然后触发 onmessage 回调。
     * 每个请求创建独立的 AbortController，transport 关闭时取消。
     *
     * @param message JSON-RPC 消息
     * @param _options 发送选项（目前未使用）
     */
    send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void>;
    /**
     * 关闭传输层
     *
     * 标记传输层为已关闭状态，取消所有进行中的请求，并触发 onclose 回调。
     */
    close(): Promise<void>;
    /**
     * 设置协议版本
     *
     * 当收到 initialize 响应时调用，用于记录协议版本。
     *
     * @param _version 协议版本
     */
    setProtocolVersion(_version: string): void;
    /**
     * 检查传输层是否已关闭
     */
    get closed(): boolean;
}
