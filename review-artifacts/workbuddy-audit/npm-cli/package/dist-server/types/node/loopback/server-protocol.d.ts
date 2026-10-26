import type { SessionOptions } from '../../vendor/cbc-core/node/index.js';
export declare const EndpointProvider: unique symbol;
export interface EndpointProvider {
    get(): Promise<string>;
    /**
     * HTTP server 绑定失败（如 EADDRINUSE）时 resolve 为该错误；成功时永不 settle。
     * get() 在绑定失败时仍保持 pending（既有语义），需要快速失败的调用方自行 race。
     */
    whenListenFailed?(): Promise<Error>;
}
export interface CommonRequest extends SessionOptions {
    /**
     * CLI `--agent`。RequestBuilder 把 `cli.opts()` 摊进 body；不是 SessionOptions
     * 字段，只给 native 会话创建时盖站立键用。ACP 请求走 `acp:true`，不在这里盖。
     */
    agent?: string;
    /** Request-level debug options forwarded from CLI/serve callers. */
    debug?: boolean | string;
    debugToStderr?: boolean;
    /** Automatically connect to a single available IDE on startup. */
    ide?: boolean;
    /** 内部恢复通道；只接受 true，SessionMiddleware 会在合并 options 前剥离。 */
    privateDataSticky?: true;
}
export interface ResumeRequest {
    resume: boolean | string;
    print: boolean;
}
export interface AddDirRequest {
    addDir?: string[];
}
