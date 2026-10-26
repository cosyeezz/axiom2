import { type Logger } from '@celljs/core';
import { type ShellExecutionHandle, type ShellNetworkBlockRecord, type ShellResult, type ShellSpecialKey } from '../shell/shell-protocol';
import { type AnsiOutput } from '../shell/terminal-serializer';
import type { NetworkBlockRecord, SandboxCLIClient } from './sandbox-cli-protocol';
export interface SandboxPtyExecutionHandleOptions {
    /** sandbox-cli 分配的远端进程 ID */
    processId: string;
    /** 远端进程 PID */
    pid: number;
    /** 执行的命令 */
    command: string;
    /** IPC 客户端引用 */
    client: SandboxCLIClient;
    /** 当前会话 ID */
    sessionId: string;
    /** 终端列数 */
    cols: number;
    /** 终端行数 */
    rows: number;
    /** 输出回调（流式增量数据） */
    onOutput?: (chunk: {
        type: 'stdout' | 'stderr';
        data: string;
        timestamp: number;
    }) => void;
    /** 日志实例 */
    logger: Logger;
    /** 中止信号 */
    abortSignal?: AbortSignal;
    /** 超时时间（毫秒） */
    timeout?: number;
}
/**
 * Sandbox 交互式 PTY 执行句柄
 *
 * 实现 ShellExecutionHandle 接口，通过 IPC 代理所有操作到 sandbox-cli 进程。
 * 使用 @xterm/headless Terminal 维护终端状态，支持 getScreen/getColorScreen。
 * 通过 processOutput/processExit 反向事件驱动 onData/onExit 事件。
 *
 * ## 构造契约（重要）
 *
 * `@xterm/headless` 位于 lazy chunk。使用 `create(options)` 自动预加载；需要在
 * IPC 响应中同步注册句柄时，先 await preloadXtermHeadless()，再调用构造器。
 * 未预加载就直接 new 会 fail-loud。
 */
export declare class SandboxPtyExecutionHandle implements ShellExecutionHandle {
    /**
     * 静态 async factory：预加载 xterm lazy chunk 后构造实例。
     * caller 位于 async 上下文（sandbox-shell-service.ts:createPtyHandle）。
     */
    static create(options: SandboxPtyExecutionHandleOptions): Promise<SandboxPtyExecutionHandle>;
    private _disposed;
    private readonly execution;
    private _result;
    private _usedAlternateBuffer;
    private readonly _onData;
    private readonly _onExit;
    private readonly _onAlternateBuffer;
    readonly onData: import("@celljs/core").Event<string>;
    readonly onExit: import("@celljs/core").Event<ShellResult>;
    readonly onAlternateBuffer: import("@celljs/core").Event<void>;
    private readonly stdoutBuf;
    private readonly stdoutDecoder;
    private readonly headlessTerminal;
    private renderTimeout;
    private readonly _processId;
    private readonly _pid;
    readonly command: string;
    private readonly _client;
    private readonly _sessionId;
    private readonly _logger;
    private readonly _onOutput?;
    constructor(options: SandboxPtyExecutionHandleOptions);
    get id(): string;
    get pid(): number;
    get sessionId(): string;
    get isAlive(): boolean;
    write(data: string): void;
    sendKey(key: ShellSpecialKey): void;
    resize(cols: number, rows: number): void;
    kill(signal?: NodeJS.Signals): Promise<void>;
    getScreen(): string;
    getColorScreen(): AnsiOutput;
    usedAlternateBuffer(): boolean;
    wait(): Promise<ShellResult>;
    dispose(): void;
    /**
     * 处理 processOutput 反向事件
     * @param base64Data Base64 编码的进程输出数据
     * @returns 这次 chunk 实际解码并 sanitizeShellChunk 后的字符串（供日志预览复用）；
     *          若 chunk 全部被留作下次 pending tail，则返回空串。
     */
    handleOutput(base64Data: string): string;
    /**
     * 处理 processExit 反向事件
     * @param exitCode 进程退出码
     * @param killed 进程是否被外部终止
     * @param decisionRecords Center 权威三态决策记录
     */
    handleExit(exitCode: number, killed?: boolean, decisionRecords?: unknown): void;
    /**
     * 发送正向 IPC 命令（fire-and-forget，不等待响应）
     */
    private _sendCommand;
    private render;
}
export interface SandboxPipeExecutionHandleOptions {
    /** sandbox-cli 分配的远端进程 ID */
    processId: string;
    /** 远端进程 PID */
    pid: number;
    /** 执行的命令 */
    command: string;
    /** IPC 客户端引用 */
    client: SandboxCLIClient;
    /** 当前会话 ID */
    sessionId: string;
    /** 输出回调（流式增量数据） */
    onOutput?: (chunk: {
        type: 'stdout' | 'stderr';
        data: string;
        timestamp: number;
    }) => void;
    /** 日志实例 */
    logger: Logger;
    /** 中止信号 */
    abortSignal?: AbortSignal;
    /** 超时时间（毫秒） */
    timeout?: number;
}
/**
 * Sandbox Pipe 模式执行句柄
 *
 * 对标 ChildProcessExecutionHandleImpl，通过 IPC 代理操作到 sandbox-cli 进程。
 * 无 xterm.js Terminal，stdout/stderr 分离存储。
 * 通过 processOutput（带 stream 字段）/processExit 反向事件驱动。
 */
export declare class SandboxPipeExecutionHandle implements ShellExecutionHandle {
    private _disposed;
    private readonly execution;
    private _result;
    private readonly _onData;
    private readonly _onExit;
    private readonly _onAlternateBuffer;
    readonly onData: import("@celljs/core").Event<string>;
    readonly onExit: import("@celljs/core").Event<ShellResult>;
    /** pipe 模式不支持检测 alternate buffer，此事件永不触发 */
    readonly onAlternateBuffer: import("@celljs/core").Event<void>;
    private readonly stdoutBuf;
    private readonly stderrBuf;
    private readonly stdoutDecoder;
    private readonly stderrDecoder;
    private readonly _processId;
    private readonly _pid;
    readonly command: string;
    private readonly _client;
    private readonly _sessionId;
    private readonly _logger;
    private readonly _onOutput?;
    constructor(options: SandboxPipeExecutionHandleOptions);
    get id(): string;
    get pid(): number;
    get sessionId(): string;
    get isAlive(): boolean;
    write(data: string): void;
    sendKey(key: ShellSpecialKey): void;
    resize(_cols: number, _rows: number): void;
    kill(signal?: NodeJS.Signals): Promise<void>;
    getScreen(): string;
    getColorScreen(): AnsiOutput;
    usedAlternateBuffer(): boolean;
    wait(): Promise<ShellResult>;
    dispose(): void;
    /**
     * 处理 processOutput 反向事件
     * @param base64Data Base64 编码的进程输出数据
     * @param stream 输出流类型："stdout" 或 "stderr"
     * @returns 这次 chunk 实际解码并 sanitizeShellChunk 后的字符串（供日志预览复用）；
     *          若 chunk 全部被留作下次 pending tail，则返回空串。
     */
    handleOutput(base64Data: string, stream: 'stdout' | 'stderr'): string;
    /**
     * 处理 processExit 反向事件
     * @param exitCode 进程退出码
     * @param killed 进程是否被外部终止
     * @param decisionRecords Center 权威三态决策记录
     */
    handleExit(exitCode: number, killed?: boolean, decisionRecords?: unknown): void;
    private _sendCommand;
}
export declare function projectDecisionRecordsToShellResult(records: unknown): Pick<ShellResult, 'decisionRecords' | 'fileBlockRecords' | 'networkBlockRecords'>;
export declare function toShellNetworkBlockRecord(record: NetworkBlockRecord): ShellNetworkBlockRecord;
