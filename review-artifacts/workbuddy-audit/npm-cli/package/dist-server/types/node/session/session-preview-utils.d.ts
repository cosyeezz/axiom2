/**
 * 会话卡片的首尾提问预览。
 *
 * 「最新提问」取的是最后一条**用户消息**而非最后一条消息：后者绝大多数情况是模型回复或工具调用结果，既
 * 有大量噪音，也无法唤起「我当时在问什么」的记忆。清洗规则与 resumable 列表的 label 保持一致，否则同一
 * 张卡片上标题与首条提问会呈现两种不同的文本形态。
 *
 * 纯图片消息（截图不配文字）在预览里整条跳过，不像标题那样回退成「图片」：标题必须始终有值，它承担的是
 * 「这个会话是什么」的告知；预览是补充信息，目的是唤起「我当时在问什么」，两个字的「图片」没有这种价
 * 值，反而会和同卡片的标题重复。跳过后展示的是相邻的真实提问，信息量更高。
 */
import type { AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
/** 截断上限。大于展示所需（卡片最多两行），留余量给前端按实际宽度截行。 */
export declare const PREVIEW_MAX_LENGTH = 200;
export interface SessionPreviews {
    firstUserMessage?: string;
    lastUserMessage?: string;
}
export declare function extractSessionPreviews(activeHistory: AgentInputItem[]): SessionPreviews;
/**
 * 会话文本的统一清洗：预览与 resumable 列表的 label 共用同一套规则。两处必须一致——同一句提问若在标题和
 * 首条提问处显示成不同文字，用户会误以为那是两条不同的消息。
 *
 * 占位符判定复用标题侧的 {@link isGeneratedPlaceholderTitle}：`(No content)` 之类的取值是普通英文，剥标
 * 签与折叠空白都拦不住，只有共用同一份定义才能保证卡片上标题与预览对「这条消息没有可读正文」的判断一致。
 * 判定放在清洗之后：`(No content)` 这类取值要等剥标签与折叠空白都做完才能确定；纯图片消息不需要在清洗前
 * 再判一次——`extractTextContent` 已经把 `<image_local_path>` 块整块跳过，到这里拿到的本来就是
 * `(No content)`。
 */
export declare function cleanSessionText(raw: string | undefined): string | undefined;
