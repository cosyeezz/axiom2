/**
 * 宿主按会话归属解析出的「档案级」系统提示词（如 Agent Home 智能体档案）。
 *
 * 和 `session.options.systemPrompt` / `appendSystemPrompt` 分开存：那两个字段属于
 * 会话发起方（server QueryOptions、定时任务），这里只由档案解析方每轮重写，
 * 两边互不覆盖。渲染时 AgentManager 按「会话显式 > 档案 > CLI 参数 > 默认」组合。
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
export interface SessionProfilePrompt {
    mode: 'append' | 'replace';
    text: string;
}
export declare function setSessionProfilePrompt(session: Session, prompt: SessionProfilePrompt | undefined): void;
export declare function getSessionProfilePrompt(session: Session | undefined): SessionProfilePrompt | undefined;
