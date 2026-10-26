/**
 * 频道选项卡卡片（对齐上游 SendMessage 的 type:widget）。
 *
 * 上游语义（照搬结论，注释记理由）：
 * - 卡片 = 一个提问 + 2–6 个可选项，用户点一个，选项的 value 作为**用户回复**
 *   回到房间，成员下一轮就能看到"用户选了 X"；
 * - **发卡片即结束本轮发言**：模型发完就该停手等用户回答，而不是继续自说自话；
 * - 选项必须是真实可选项，不能现编占位；能用查证解决的别问卡片
 *   （上游把"少问"写进工具描述：默认自己决定并推进）。
 *
 * 我们这里的映射：卡片是一条频道消息（kind='widget'），用户点击后走普通的
 * 用户发言（带 replyTo 指向卡片），因此"是否已答"完全可以从既有消息流推导，
 * 不需要改写历史 —— transcript 仍是 append-only。
 */
/** 选项上限对齐上游 widget 的 1–6（我们要求至少 2：一个选项不算选择题）。 */
export declare const CHANNEL_WIDGET_MIN_OPTIONS = 2;
export declare const CHANNEL_WIDGET_MAX_OPTIONS = 6;
/** 卡片标题与选项文本的长度上限（防止把整段话塞进卡片）。 */
export declare const CHANNEL_WIDGET_PROMPT_MAX = 500;
export declare const CHANNEL_WIDGET_LABEL_MAX = 120;
export type AgentHomeChannelWidgetStyle = 'default' | 'primary' | 'danger';
export interface AgentHomeChannelWidgetOption {
    /** 选项按钮上的文字。 */
    label: string;
    /** 用户选中后回传给模型的文本；缺省 = label。 */
    value?: string;
    style?: AgentHomeChannelWidgetStyle;
}
export interface AgentHomeChannelWidget {
    prompt: string;
    helpText?: string;
    options: AgentHomeChannelWidgetOption[];
}
export type NormalizeChannelWidgetResult = {
    ok: true;
    widget: AgentHomeChannelWidget;
} | {
    ok: false;
    reason: string;
};
/**
 * 校验并归一化模型给的卡片。失败返回人话原因（工具结果会原样转告模型，
 * 让它改成合法的卡片或改用普通发言）。
 */
export declare function normalizeChannelWidget(raw: unknown): NormalizeChannelWidgetResult;
