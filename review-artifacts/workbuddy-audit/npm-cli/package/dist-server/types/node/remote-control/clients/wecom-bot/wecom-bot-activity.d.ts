/**
 * One-line WeCom activity. Full-replace only; never a template card.
 * Do not leak Bash command, file contents, or Agent prompt.
 */
export declare const WECOM_PROGRESS_MIN_INTERVAL_MS = 800;
export declare const WECOM_PROGRESS_HEARTBEAT_MS = 15000;
export interface WecomToolActivity {
    phase: 'start' | 'end';
    name: string;
    callId?: string;
    preview?: string;
    fromSubAgent: boolean;
}
export declare function isHiddenWecomActivityTool(name: string | undefined): boolean;
export declare function stripWecomThinkBlocks(text: string): string;
export declare function isWecomProgressText(text: string | undefined | null): boolean;
export declare function wecomFilePreviewFromArgs(name: string, raw: unknown): string | undefined;
export declare function wecomToolActivityFromEvent(event: unknown): WecomToolActivity | undefined;
export declare function formatWecomActivity(tools: Array<{
    name: string;
    fromSubAgent?: boolean;
    preview?: string;
}>, elapsedSec?: number): string;
