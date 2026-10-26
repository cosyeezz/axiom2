/** 折叠回车覆盖：spinner 等进度动画用 \r 反复重画同一行，只保留每行最后一个 \r 之后的内容。 */
export declare const collapseCarriageReturns: (text: string) => string;
/**
 * 把 shell 输出转成可显示的文本：剥 OSC/DCS 等字符串序列、非 SGR 控制序列与
 * 字符集控制，再折 \r 重画；SGR 颜色序列保留。
 *
 * 只用于人看的文本（`renderer.value` 与流式 `content`），不碰 `llmContent`；
 * 入参是攒好的完整 buffer，因此 \r 折叠可以正确按行处理。
 */
export declare const toShellDisplayText: (text: string) => string;
