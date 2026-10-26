import { type Session } from '../../vendor/cbc-core/node/index.js';
import type { UserMessageItem } from '../../vendor/cbc-shared/node/index.js';
interface ImageContentLogger {
    info(message: string): void;
    warn(message: string): void;
}
/**
 * 用户消息里图片的模型侧加工（#140576），新一轮 prompt 与 steer 共用同一份实现：
 * - run 起点由 `ImageCompressionAgentRunInterceptor` / `ImageFilterAgentRunInterceptor` 调用；
 * - steer 在插入点对模型输入副本调用（它不经过 run 拦截器，而是在 run 中途进入 RunState）。
 */
export declare namespace UserImageContent {
    /** 长边压缩 data URI 图片；就地替换，失败保留原图。 */
    function compress(message: {
        content: unknown;
    }, logger?: ImageContentLogger): Promise<void>;
    /** 模型不支持图片时去掉 input_image；返回去掉的张数。 */
    function strip(message: UserMessageItem): number;
    /** steer 插入点：按会话当前模型能力过滤 / 压缩模型输入副本，与 run 起点的两个拦截器结果一致。 */
    function prepareForModel(session: Session, messages: UserMessageItem[], logger?: ImageContentLogger): Promise<void>;
}
export {};
