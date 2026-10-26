import { Logger } from '@celljs/core';
import type { Session } from '../../vendor/cbc-core/node/index.js';
export declare const ShellStreamPusher: unique symbol;
export interface ShellStreamPusherOptions {
    toolName: string;
    resultId: string;
    callId: string;
    /** 从工具开始执行攒到当下的**全量**输出 buffer（追加 statusText 后的整体文本），不是增量 delta。
     *  \r 折叠与半截序列收尾都依赖全量语义：传 delta 会导致帧间内容错乱且无任何报错。 */
    value: string;
    /**
     * 把这一帧额外镜像进 `combineSubject`。
     *
     * 没有任何东西把 `inputSubject` 桥接进 `combineSubject`（只有 `addHistory()` 对真实历史项
     * 做双推），而 ACP 与 stream-json 两端都只订阅 `combineSubject` —— 见 a2a-get-task-tool
     * 里 issue #99451 的实测结论。所以只推 `inputSubject` 的帧在真机上根本看不到。
     * 默认 false：Bash / REPL 维持既有行为，需要真正上屏的调用方显式打开。
     */
    mirrorToCombineSubject?: boolean;
}
export interface ShellStreamPusherService {
    push(session: Session | undefined, opts: ShellStreamPusherOptions): void;
}
/**
 * shell 类工具（Bash / REPL）的流式进度推送：统一拼 function_call_result 帧，
 * value 过 toShellDisplayText 后作为 `renderer.value` 与流式 `content` 下发。
 *
 * 流式帧直接走 inputSubject（不进 history、不过 AgentInputItemProcessor 链），
 * 因此最终结果的清洗出口（input-item-processors）覆盖不到这里，由本服务补位。
 */
export declare class ShellStreamPusherImpl implements ShellStreamPusherService {
    protected readonly logger: Logger;
    push(session: Session | undefined, opts: ShellStreamPusherOptions): void;
}
