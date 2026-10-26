import type { CombineEvent } from '../../vendor/cbc-core/node/index.js';
import type { Message } from '../cli/stream-json-protocol';
/** 把内核标题历史项投影为进程内 server 的实时订阅事件。 */
export declare function translateServerTitleEvent(event: CombineEvent, sessionId: string): Extract<Message, {
    type: 'ai-title' | 'topic';
}> | undefined;
