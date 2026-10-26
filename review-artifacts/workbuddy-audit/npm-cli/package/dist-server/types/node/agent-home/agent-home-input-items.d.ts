/**
 * 模型输入项的通用取值：user message 的文本、tool 结果的文本。
 *
 * 频道侧与同事侧（含遗留的房间私信）都要用，所以从 colleague-turn 里搬出来单放——
 * 否则频道收发为了两个纯函数要依赖整个 1:1 模块（跨特性耦合）。
 */
import type { FunctionCallResultItem, UserMessageItem } from '../../vendor/cbc-shared/node/index.js';
export declare function userMessageText(item: UserMessageItem): string;
export declare function toolOutputText(item: FunctionCallResultItem): string;
