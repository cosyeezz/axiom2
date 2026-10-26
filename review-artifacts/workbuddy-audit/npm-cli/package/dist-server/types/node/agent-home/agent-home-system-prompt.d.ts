/**
 * 智能体档案上的系统提示词：纯类型 + 纯校验，HTTP、读盘清洗、运行时注入与 web-ui 共用一份。
 *
 * ⚠️ 本文件会被 web-ui 直接 import：别引 node 侧模块。
 */
/** append = 叠在产品默认提示词之后；replace = 替换默认提示词（仅主对话轮次）。 */
export type AgentHomeSystemPromptMode = 'append' | 'replace';
export interface AgentHomeSystemPrompt {
    mode: AgentHomeSystemPromptMode;
    text: string;
}
/** 系统提示词长度上限：比普通描述长得多，但仍要防止目录文件被撑爆。 */
export declare const AGENT_HOME_SYSTEM_PROMPT_MAX = 32000;
/**
 * 归一化外部输入（HTTP body / 手改过的 directory.json）。
 * 返回 null = 显式清空；undefined = 输入非法（调用方按自己的语义拒绝或忽略）。
 */
export declare function normalizeAgentHomeSystemPrompt(raw: unknown): AgentHomeSystemPrompt | null | undefined;
