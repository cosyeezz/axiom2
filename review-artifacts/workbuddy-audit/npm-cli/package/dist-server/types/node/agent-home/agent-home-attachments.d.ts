/**
 * 频道附件：对齐上游 SendMessage 的 type:attachment（file:// 路径 → 房间可见的文件）。
 *
 * 设计取舍：
 * - **落盘复制而不是引用原路径**：成员的工作目录会被后续 turn 覆盖/清理，
 *   只存路径的话过几轮就 404；复制一份才谈得上"房间里的东西一直在"。
 * - **有类型与体积上限**：频道是给人看的，不是对象存储。超限/不认识的类型
 *   直接拒绝（由调用方转告模型），避免把 GB 级二进制塞进 agent-home 目录。
 * - **存内容寻址的文件名**：<sha256 前 16 位><ext>，天然去重、也不怕名字里有
 *   斜杠/换行/中文导致路径穿越或展示问题；展示名另存在消息里。
 */
import { CHANNEL_ATTACHMENT_MAX_BYTES, CHANNEL_ATTACHMENT_MAX_PER_MESSAGE } from './agent-home-limits';
/** 上限的唯一来源在 agent-home-limits（web-ui 也直接消费），这里只是 re-export 兼容既有调用方。 */
export { CHANNEL_ATTACHMENT_MAX_BYTES, CHANNEL_ATTACHMENT_MAX_PER_MESSAGE };
export interface ChannelAttachment {
    /** 展示名（原文件名）。 */
    name: string;
    /** 存储文件名（内容寻址，直接拼在频道附件目录下）。 */
    file: string;
    mime: string;
    size: number;
}
/** 频道附件目录：<homeDir>/agent-home/attachments/<channelId>/。 */
export declare function channelAttachmentsDir(homeDir: string, channelId: string): string;
export declare function channelAttachmentMime(name: string): string;
/**
 * 展示名净化（落盘文件名不用它，只进消息与扩展名推导）：
 * 取 basename（路径分隔符一律当分隔符，含 Windows 反斜杠）、去控制字符、截 200。
 * HTTP 上传的名字是**外部输入**，所以这条必须在入口处做，不能只靠"调用方给的是路径"。
 */
export declare function channelAttachmentDisplayName(raw: string | undefined): string;
/**
 * 存储文件名白名单：`<sha256 前 16 位>[.扩展名]`。
 * POST /messages 会收到客户端回传的 `file`（上传时服务端给的哈希名），
 * 必须按这条白名单收窄，不能靠"里面没有斜杠"隐式成立。
 */
export declare function normalizeChannelAttachmentFile(raw: unknown): string | undefined;
/**
 * 按字节收进频道附件目录（浏览器上传与本地路径两条入口共用的一套规则）。
 * 失败返回原因字符串（给调用方看的人话），成功返回落盘信息。
 */
export declare function storeChannelAttachmentBytes(input: {
    homeDir: string;
    channelId: string;
    bytes: Buffer;
    /** 展示名（原文件名）；缺省回落 "attachment"。 */
    name?: string;
}): Promise<{
    ok: true;
    attachment: ChannelAttachment;
} | {
    ok: false;
    reason: string;
}>;
/**
 * 把一个本地文件收进频道附件目录。
 * 失败返回原因字符串（给模型看的人话），成功返回落盘信息。
 */
export declare function ingestChannelAttachment(input: {
    homeDir: string;
    channelId: string;
    sourcePath: string;
    /** 展示名；缺省用原文件名。 */
    name?: string;
}): Promise<{
    ok: true;
    attachment: ChannelAttachment;
} | {
    ok: false;
    reason: string;
}>;
/**
 * 解析一个可对外读取的附件（HTTP 路由 / 发消息校验用）：路径 + 真实大小。
 * 任何越界/未知文件一律 undefined —— 和 attachments-service 一样的包含性纪律。
 */
export declare function resolveChannelAttachment(input: {
    homeDir: string;
    channelId: string;
    file: string;
}): Promise<{
    path: string;
    size: number;
} | undefined>;
