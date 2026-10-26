import type { AgentInputItem } from '../../../cbc-shared/node/index.js';
/**
 * Check if session history contains a user-set custom title.
 */
export declare function isGeneratedPlaceholderTitle(title: string | undefined): boolean;
export declare function hasCustomTitle(messages: AgentInputItem[]): boolean;
/**
 * Whether history already contains a *real* AI-generated title (`ai-title` or
 * legacy `topic`), ignoring placeholder values such as `(No content)`,
 * `/compact`, or `<image_local_path>...</image_local_path>`.
 *
 * This must share the exact same placeholder definition used by
 * {@link getEffectiveSessionTitle} so the display layer and the trigger-state
 * rebuild ({@link SessionTitleServiceImpl.createStateFromHistory}) agree on
 * what counts as "already titled". Otherwise a placeholder title would be shown
 * as "no effective title" yet still mark generation as done, leaving the
 * session stuck on the placeholder forever.
 */
export declare function hasGeneratedTitle(messages: AgentInputItem[]): boolean;
/**
 * Resolve the effective session title by priority:
 * custom-title > ai-title > legacy topic > first real user message
 */
export declare function getEffectiveSessionTitle(messages: AgentInputItem[]): string | undefined;
/**
 * Keep the single title item that currently owns the session title when
 * runtime history is compacted. Title metadata is not model context and must
 * not disappear merely because old conversation turns are trimmed.
 */
export declare function getEffectiveSessionTitleItem(messages: AgentInputItem[]): AgentInputItem | undefined;
/** 标题 item 类型 → 标题文本字段。 */
declare const SESSION_TITLE_TEXT_FIELDS: {
    readonly 'custom-title': 'customTitle';
    readonly 'ai-title': 'aiTitle';
    readonly topic: 'topic';
};
export type SessionTitleItemType = keyof typeof SESSION_TITLE_TEXT_FIELDS;
/**
 * 一条可持久化的标题事实（#138181）：原 item 的类型、id、标题文本与落盘时间戳，
 * 不带 parent 链接 / sessionId。形状与标题 item 兼容，可以和 item 混排后用
 * {@link resolveSessionTitleFacts} 折叠。
 */
export interface SessionTitleFact {
    type: SessionTitleItemType;
    id?: string;
    timestamp?: number;
    customTitle?: string;
    aiTitle?: string;
    topic?: string;
}
export declare function isSessionTitleItemType(type: unknown): type is SessionTitleItemType;
/**
 * 从标题 item / 标题事实里取出标题服务依赖的事实：最新的真实生成标题（`ai-title`，
 * 没有时是 `topic`）与最新的非空 `custom-title`，与 {@link hasGeneratedTitle} /
 * {@link hasCustomTitle} / {@link getEffectiveSessionTitleItem} 同一判定（占位标题不算）。
 *
 * 「最新」先比 `timestamp`，缺失或相同再按 `items` 的顺序（调用方按文件序传入）。
 * 只按位置排序不够：另一个进程补写的快照可能带着旧事实落在更新的重命名之后。
 * 顺序固定为 [生成, 自定义]。
 */
export declare function resolveSessionTitleFacts(items: ReadonlyArray<unknown>): SessionTitleFact[];
/** 读回持久化的标题事实；形状不对（手改 / 未来格式）按「没有」处理。 */
export declare function parseSessionTitleFacts(value: unknown): SessionTitleFact[] | undefined;
/** `items` 里已有这条标题：同 id，或同类型同文本（fork 克隆的标题 id 会被重铸）。 */
export declare function hasMatchingTitleItem(items: ReadonlyArray<AgentInputItem>, fact: SessionTitleFact): boolean;
/**
 * Extract the first real user message's full text, used as the LLM input for
 * title generation. Unlike `getEffectiveSessionTitle`'s fallback (which
 * truncates to 80 chars for display), this returns the untruncated text so the
 * model has the complete intent to summarize. Returns undefined when there is
 * no usable first user message (e.g. only system/command/image-only turns).
 */
export declare function getFirstRealUserMessageText(messages: AgentInputItem[]): string | undefined;
/**
 * Like {@link getFirstRealUserMessageText}, but returns the first real user
 * message whose text is at least `minLength` characters.
 *
 * Rationale: titling is anchored on the *first* user message so a session's
 * title reflects its opening intent. But if that first message is too short to
 * be title-worthy (e.g. "1", "hi"), anchoring strictly on it would deadlock —
 * every subsequent prompt re-reads the same too-short first message, fails the
 * length floor, and the session stays permanently untitled no matter how much
 * the user types later. Skipping to the first message that clears the floor
 * both breaks that deadlock and yields a more representative title.
 */
export declare function getFirstUsableUserMessageText(messages: AgentInputItem[], minLength: number): string | undefined;
export {};
//# sourceMappingURL=session-title-utils.d.ts.map