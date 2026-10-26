import type { UserMessageItem } from '../../../cbc-shared/node/index.js';
import { type SteerDrainedGroup, type SteerInputBuffer, type SteerInputDisposition, type SteerPushInput } from './steer-input-buffer-protocol';
/**
 * SteerInputBuffer 的默认实现（#85193）。
 *
 * 以会话 id 为索引暂存待插入的消息。每组内容记 `ownerRequestId`：drain/has 只认
 * 归属当前请求的组，陈旧组（当前 run 已异常终止后残留的）被丢弃，杜绝跨轮误注入。
 * `clear` 在会话销毁时释放整段，避免长活进程下 Map 泄漏。
 */
export declare class SteerInputBufferImpl implements SteerInputBuffer {
    private readonly store;
    pushMessages(sessionId: string, messages: readonly UserMessageItem[], input: SteerPushInput, signal?: AbortSignal): Promise<SteerInputDisposition>;
    drain(sessionId: string, currentRequestId: string | undefined): SteerDrainedGroup[];
    has(sessionId: string, currentRequestId: string | undefined): boolean;
    clear(sessionId: string): void;
}
//# sourceMappingURL=steer-input-buffer.d.ts.map