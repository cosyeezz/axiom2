/**
 * 在 operation 执行期间，把 `modelId` 绑定到当前 async 作用域；
 * 期间由该作用域内发出的任何 MCP HTTP 请求都会被自动注入 `X-Model-ID`。
 *
 * 当 `modelId` 缺失、或 transport 不带 HTTP fetch 钩子（如 stdio）时，
 * 直接执行 operation 不做注入。
 */
export declare function withMcpModelIdHeader<T>(params: {
    serverName: string;
    transport: unknown;
    modelId?: string;
}, operation: () => Promise<T>): Promise<T>;
