import { type AgentInputItem } from '../../../cbc-shared/node/index.js';
import type { NotificationInjectionEntry } from './notification-injection-buffer-protocol';
import type { SteerDrainedGroup } from './steer-input-buffer-protocol';
/**
 * 待插入内容的文本抽取与可插入性判定（#85193）。
 *
 * `isSteerableContent`：steer 入口（ACP `session/steer` / `send_followup_now`，以及后台通知 drain 轮
 * 期间正常发送、被插入当前轮的用户 prompt）。steer 与普通 prompt 使用同一套用户输入转换，图片随消息
 * 进入模型（#140576、#141249），因此有文本**或有图片**即可。拒绝斜杠命令，兼容 `<channel>` 包裹
 * （channel 消息里的斜杠命令同样识别）。
 */
/** 把一组 contentBlock 里的文本抽出并用换行拼接（string 块与 {type:'text'} 块都算，非文本块忽略）。 */
export declare function contentBlocksToText(contentBlocks: unknown[]): string;
/** 判断文本是否为斜杠命令（如 /commit），兼容 <channel> 包裹。 */
export declare function isSlashCommandText(text: string): boolean;
/** 一组 ACP contentBlocks 是否可 steer 进当前一轮：非斜杠命令，且有文本或有图片。 */
export declare function isSteerableContent(contentBlocks: unknown[]): boolean;
/**
 * 把若干组已准入的 steer 消息拼成模型输入 + 历史项 + 实时回执（#87145 / #95921 / #140576）。
 *
 * 每组的 `messages` 与普通 prompt 一样是完整 user message（可含 `input_image`），本函数只做
 * steer 独有的三件事，不再改写内容：
 * - **注入项 `items`**（喂模型）：每条消息原样放进 `<system-reminder data-role="message-queue">`
 *   包装（包装文本在内容前后各一个 input_text），图片随之进入模型。
 * - **历史项 `historyItems`**（落盘）：消息对象本身（按引用，保留准入标记）。带 `clientUserMessageId`
 *   的单消息组把它落为 item.id，保证 CLI 回放的 `user_message_chunk.messageId` 与实时回执一致；
 *   带 `clientMeta` 时原样挂进 `providerData.clientMeta`（CLI 不解读，WorkBuddy 据此识别 steer）。
 * - **实时回执 `emitInfos`**：仅带 `clientUserMessageId` 的组产出一条，`clientMeta` 随事件携带。
 */
export declare function buildSteerInjectionInput(groups: readonly SteerDrainedGroup[]): {
    items: AgentInputItem[];
    historyItems: AgentInputItem[];
    emitInfos: Array<{
        text: string;
        clientUserMessageId: string;
        clientMeta?: unknown;
    }>;
} | undefined;
/**
 * 把若干条后台任务完成通知 XML 拼成一条可注入的模型输入（#89130）。
 *
 * 与 {@link buildSteerInjectionInput} 的三点关键区别（因此不复用它）：
 * 1. **保留 isMeta**：通知以 `user(xml, { isMeta: true })` 构造，`providerData.isMeta=true`。
 *    落历史项同样带 isMeta——否则会污染 `acp-view` 的 `resolvedUserItemId`/resend fork
 *    （那里显式跳过 isMeta 的 user 项）。
 * 2. **不包 `<system-reminder data-role="message-queue">`**：通知不是「用户发的消息」，
 *    且 `<task-notification>` 本身已能被 `MessageUtils.isSystemInjectedContent` 识别，
 *    无需再包 `<user_query>`。原样拼接、`\n\n` 分隔即可。
 * 3. **不走 `isSteerableContent` 斜杠命令过滤**：通知是系统内容，不该被误杀。
 *
 * 注入项与历史项复用同一个 `user()` 构造（含 id 生成），与 notifier 现有构造路径同形。
 *
 * @param xmls 已拼好的通知 XML 列表（`drain` 出来、非空）
 */
export declare function buildNotificationInjectionInput(xmls: readonly string[]): {
    item: AgentInputItem;
    historyItems: AgentInputItem[];
};
/** Build model and history inputs from buffered XML and structured system entries. */
export declare function buildBufferedNotificationInputs(entries: readonly NotificationInjectionEntry[]): {
    items: AgentInputItem[];
    historyItems: AgentInputItem[];
};
//# sourceMappingURL=injectable-content.d.ts.map