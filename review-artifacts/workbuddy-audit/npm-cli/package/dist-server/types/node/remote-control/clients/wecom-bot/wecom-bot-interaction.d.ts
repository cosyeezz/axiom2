/**
 * WeCom template-card adapter for interactive tools.
 *
 * Tools (permission adapter / AskUserQuestion / prompt suggestion) stay unchanged.
 * This module converts their prompts into vote_interaction cards so options stay
 * a vertical list. WeCom lays button_interaction actions in one row and squeezes
 * the labels; vote_interaction does not.
 *
 * Send card: https://developer.work.weixin.qq.com/document/path/101032
 * Update card: https://developer.work.weixin.qq.com/document/path/94888
 * Click event: event.template_card_event.{task_id,event_key,selected_items}
 */
/** vote_interaction 没有 sub_title_text，命令参数只能放 main_title.desc。 */
export declare const WECOM_VOTE_DESC_MAX = 160;
/** Official vote_interaction option_list cap. */
export declare const WECOM_ASK_OPTION_MAX = 20;
export declare const WECOM_CARD_TYPE_BUTTON = "button_interaction";
export declare const WECOM_CARD_TYPE_VOTE = "vote_interaction";
export declare const WECOM_INTERACTION_QUESTION_KEY = "choice";
export declare const WECOM_INTERACTION_KEY: {
    readonly ALLOW: "allow";
    readonly DENY: "deny";
    readonly ALLOW_ALWAYS: "allow_always";
    readonly EXIT_PLAN: "deny_and_exit_plan";
    readonly SUGGEST_YES: "suggest_yes";
    readonly SUGGEST_NO: "suggest_no";
    readonly SUBMIT: "submit";
    readonly ASK_SUBMIT: "ask_submit";
};
export type WecomInteractionKey = (typeof WECOM_INTERACTION_KEY)[keyof typeof WECOM_INTERACTION_KEY];
export interface WecomTemplateCardButton {
    text: string;
    style: 1 | 2 | 3 | 4;
    key: string;
}
export interface WecomButtonCard {
    card_type: typeof WECOM_CARD_TYPE_BUTTON;
    main_title: {
        title: string;
        desc?: string;
    };
    sub_title_text?: string;
    button_list: WecomTemplateCardButton[];
    task_id: string;
    replace_text?: string;
}
export interface WecomVoteOption {
    id: string;
    text: string;
    is_checked?: boolean;
}
export interface WecomVoteCard {
    card_type: typeof WECOM_CARD_TYPE_VOTE;
    main_title: {
        title: string;
        desc?: string;
    };
    sub_title_text?: string;
    checkbox: {
        question_key: string;
        option_list: WecomVoteOption[];
        mode: 0 | 1;
        disable?: boolean;
    };
    submit_button: {
        text: string;
        key: string;
    };
    task_id: string;
    replace_text?: string;
}
export type WecomTemplateCard = WecomVoteCard | WecomButtonCard;
export interface WecomCardClick {
    taskId: string;
    eventKey: string;
    reqId: string;
    chatid?: string;
    chattype?: string;
    userid?: string;
    selectedOptionIds?: string[];
}
export declare function isWecomVoteCard(card: WecomTemplateCard): card is WecomVoteCard;
export declare function isWecomSubmitKey(key: string): boolean;
export declare function sanitizeWecomTaskId(raw: string): string;
export declare function clipWecomCardText(text: string, max: number): string;
export declare function askOptionKey(index: number): string;
export declare function parseAskOptionKey(key: string): number | undefined;
export declare function interactionOptionText(option: {
    label: string;
    description?: string;
}): string;
export declare function parseSelectedOptionIds(source: unknown): string[];
export declare function clickActionKeys(click: WecomCardClick): string[];
export declare function buildVoteInteractionCard(input: {
    taskId: string;
    title: string;
    desc?: string;
    questionKey?: string;
    multiSelect?: boolean;
    options: Array<{
        id: string;
        text: string;
        checked?: boolean;
    }>;
    submitKey?: string;
    submitText?: string;
    disable?: boolean;
    replaceText?: string;
}): WecomVoteCard;
export declare function buildPermissionCard(input: {
    taskId: string;
    body: string;
    exitPlan: boolean;
    toolName?: string;
}): WecomVoteCard;
export declare function formatAskSelectedAnswer(options: Array<{
    label: string;
}>, selected: number[]): string;
export declare function buildAskQuestionCard(input: {
    taskId: string;
    question: string;
    header?: string;
    options: Array<{
        label: string;
        description?: string;
    }>;
    index: number;
    total: number;
    multiSelect?: boolean;
    selected?: number[];
}): WecomVoteCard;
export declare function buildSuggestionCard(input: {
    taskId: string;
    suggestion: string;
}): WecomVoteCard;
export declare function buildResolvedCard(input: {
    taskId: string;
    title: string;
    desc?: string;
}): WecomVoteCard;
export declare function parseTemplateCardClick(payload: unknown, reqId: string): WecomCardClick | undefined;
export declare function permissionBehaviorFromKey(key: string, exitPlan: boolean): 'allow' | 'allow_always' | 'deny' | 'deny_and_exit_plan' | undefined;
