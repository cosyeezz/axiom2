/**
 * MonitorTool `ws` 事件源的 WebSocket 客户端（issue #74436）。
 *
 * 为什么不复用现有实现
 * ====================
 * - `mcp/node-websocket-transport.ts`：实现的是 MCP SDK `Transport` 接口，`onmessage`
 *   签名硬编码为 `JSONRPCMessage`、收到消息即 `JSON.parse`。本工具要的是「任意文本
 *   原样透传」，协议假设完全不同。更关键的是它**完全不处理 close code**
 *   （`:106-108,125-127` 的 close 回调不接任何参数），而 CC 明确要求把 close code
 *   回传给模型。
 * - `remote-control/clients/centrifugo/centrifugo-client.ts`：绑定 Centrifugo pub/sub
 *   协议与其鉴权模型，不是通用客户端。
 *
 * 因此新写一个薄封装。职责边界刻意收窄：**只负责把 socket 活动翻译成回调**，
 * 不碰 BackgroundTask / 事件 XML / 权限 —— 那些留在 monitor-tool.ts，便于单测。
 *
 * 对齐 CC 的 socket 活动语义（Tools Reference `WebSocket source`）
 * ==============================================================
 * | socket 活动          | 行为                                        |
 * |----------------------|---------------------------------------------|
 * | 文本消息             | 一条消息 = 一个事件（**即使跨多行也不拆**） |
 * | 二进制帧             | 不透传，替换为 `[binary frame, N bytes]`    |
 * | 单条消息 > 1 MiB     | **结束 watch**                              |
 * | socket 关闭          | **结束 watch，并把 close code 交给模型**    |
 *
 * 注意「一条消息 = 一个事件」与 command 模式不同：command 模式按 500ms tick 合并多行
 * 成一条事件（`monitor-tool.ts:97`「避免逐行刷屏」）。ws 侧严格不合并，因为消息边界
 * 是协议语义，合并会破坏它。
 */
/** CC 规定的单条消息上限：超过即结束 watch。 */
export declare const WS_MAX_MESSAGE_BYTES: number;
/** watch 的终止原因，决定收尾事件的措辞。 */
export type WsEndReason = 
/** 对端关闭（或本地 close 后对端回 close 帧），带 close code。 */
{
    kind: 'closed';
    code?: number;
    reason?: string;
}
/** 单条消息超过 1 MiB。 */
 | {
    kind: 'oversized';
    bytes: number;
}
/** 连接层错误（握手失败、网络中断等）。 */
 | {
    kind: 'error';
    message: string;
};
export interface MonitorWsHandlers {
    /** 一条文本消息。原样透传，不做 JSON 解析、不按行拆分。 */
    onText(text: string): void;
    /** 一个二进制帧。CC 不透传内容，只给占位符所需的字节数。 */
    onBinary(byteLength: number): void;
    /** watch 终止。保证**最多调用一次**，且之后不再有 onText/onBinary。 */
    onEnd(reason: WsEndReason): void;
}
/** 已建立的 ws 事件源句柄。 */
export interface MonitorWsHandle {
    /** 主动关闭。幂等；不会触发 `onEnd`（调用方自己知道是主动停的）。 */
    close(): void;
}
/** CC 的二进制帧占位符文案，形如 `[binary frame, 512 bytes]`。 */
export declare function formatBinaryFramePlaceholder(byteLength: number): string;
/**
 * 建立 ws 连接。**在 resolve 之前完成握手**，因此调用方 `await` 返回后即可认为已连上；
 * 握手失败会 reject，让 `execute()` 能直接把错误回给模型，而不是先返回一个
 * task_id、稍后才通过事件告知连不上（后者对模型很难处理）。
 *
 * 安全前提：调用方**必须**先跑 `checkWsNetworkPolicy`。本函数不做任何 URL 校验。
 */
export declare function openMonitorWsSource(url: string, protocols: string[] | undefined, handlers: MonitorWsHandlers): Promise<MonitorWsHandle>;
