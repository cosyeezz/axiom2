import { type ToolActionProjection } from './protocol';
import { type ToolRiskReviewContext } from './review-context';
export declare function buildToolRiskReviewSystemPrompt(customRules?: readonly string[]): string;
export declare const TOOL_RISK_REVIEW_SYSTEM_PROMPT: string;
export declare function buildToolRiskReviewUserPrompt(context: ToolRiskReviewContext, summaryLanguage?: 'zh-CN' | 'en', customRules?: readonly string[]): string;
export declare function isToolRiskProjectionComplete(projection: ToolActionProjection, hostFacts?: ToolRiskReviewContext['hostFacts'], customRules?: readonly string[]): boolean;
