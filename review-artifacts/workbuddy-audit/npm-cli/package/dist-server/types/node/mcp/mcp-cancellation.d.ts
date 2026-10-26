/**
 * 客户端侧的 MCP 请求取消（`notifications/cancelled`）。
 *
 * MCP 规范：客户端放弃一个已发出的请求时 SHOULD 向 server 发
 * `notifications/cancelled { requestId, reason }`，让 server 有机会终止底层工作
 * （杀子进程、断上游 HTTP、停轮询），而不是把结果算完再交给一个没人接的连接。
 *
 * 发送侧在 `@modelcontextprotocol/sdk` 里已经实现好了：`Protocol.request` 只要
 * 拿到 `RequestOptions.signal`，signal abort 时就会自动发出该通知并 reject 本地
 * Promise（见 SDK `shared/protocol.ts` 的 `cancel()`）。`mcp-server-override` 的
 * `__signal` sideband 也早就把 meta 接到了 `RequestOptions.signal` 上。
 *
 * 缺的只是「谁来喂这个 signal」：此前只有微信支付长轮询显式传 `__signal`，
 * 普通 MCP 工具调用一律不传 —— 用户按停止 / 新一轮取代旧一轮时，在途的
 * `tools/call` 只是被本地静默丢弃，server 侧仍然跑到底。本模块把
 * 「本轮 run 的中断」桥成一个可以安全交给 SDK 的 signal，补上这一环。
 */
/**
 * `notifications/cancelled.params.reason` 的取值。
 *
 * SDK 用 `String(signal.reason)` 填这个字段，所以这里必须 abort 一个字符串
 * （abort 一个 Error 会得到 `"Error: ..."` 这种带前缀的噪音文案）。
 */
export declare const MCP_CANCEL_REASON_CLIENT_STOPPED = "Client cancelled the in-flight tool call";
/** 本模块只需要 Session 的这两个字段，收窄依赖便于单测构造。 */
export interface McpCancellableSession {
    abortSignal?: AbortSignal;
    lastAbortReason?: 'user' | 'internal';
}
export interface McpCallCancellation {
    /**
     * 交给 `RequestOptions.signal` 的 signal；`undefined` 表示本次调用不接取消线。
     */
    readonly signal: AbortSignal | undefined;
    /**
     * 摘除挂在 `session.abortSignal` 上的监听器。幂等，**必须**在调用 settle 后执行。
     *
     * 一轮 run 里可能发生几十次 MCP 调用，而它们共享同一个 `session.abortSignal`；
     * 不摘监听器会累积到 Node 的 `MaxListenersExceededWarning`（EventTarget 阈值 10）。
     */
    dispose(): void;
}
/**
 * 为一次 MCP `tools/call` 派生取消 signal。
 *
 * @param explicitSignal 调用方经 `meta.__signal` 显式传入的 signal（微信支付长轮询）。
 *                       显式传入优先，原样透传，不做任何包装。
 * @param session        当前会话；取 `abortSignal` 作为取消源。
 *
 * 两条刻意的保守规则：
 *
 * 1. **调用开始时 signal 已经 aborted → 不接线**。此时 run 早已结束，拿到的是
 *    上一轮遗留的 controller（`createRunStartupController` 只在下一轮启动时才换新的）。
 *    非 run 路径的调用方（`/mcp` 手动调用、mcp-ui 反向调用）会因此被误判成"已取消"，
 *    把本来能成功的调用打挂。只有「开始时 run 还活着」的在途调用才需要取消语义。
 * 2. **`lastAbortReason === 'internal'` 时不取消**。与 BashTool 同一把尺子
 *    （见 `bash-tool.ts` 的 `onAbort`）：turn 切换 / compact 这类内部流程也会 abort
 *    `session.abortSignal`，但那不代表用户要停掉这个工具。未显式标记时按 `'user'`
 *    处理，保持既有语义。
 */
export declare function createMcpCallCancellation(explicitSignal: AbortSignal | undefined, session: McpCancellableSession | undefined): McpCallCancellation;
/**
 * 该次调用是否由我们主动取消（用于把"用户取消"与"server 真失败"在埋点/日志上分开）。
 */
export declare function isMcpCallCancelled(cancellation: McpCallCancellation): boolean;
