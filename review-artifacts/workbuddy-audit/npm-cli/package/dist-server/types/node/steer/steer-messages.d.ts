import { type UserMessageItem } from '../../vendor/cbc-shared/node/index.js';
/**
 * 把 steer 输入整理成待插入当前一轮的原生 user message（#140576）。
 *
 * Server、ACP `session/steer`、stream-json `steer` 共用：只接受 user 消息；斜杠命令、
 * 既无文本也无图片 / 文件的内容抛 `TypeError`（调用方交给普通 prompt）；生成新 id，标记
 * 不开启新一轮，并归属到当前请求。
 */
export declare function prepareSteerMessages(input: string | unknown[], runId: string): UserMessageItem[];
