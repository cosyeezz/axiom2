export declare function summarizeHookCommand(command: string | undefined): string | undefined;
/**
 * 阻断理由的单行日志摘要：折叠换行、限长。完整原文仍在 blockingDetails 并下发给模型，
 * 日志只需足够定位（hook 文案常是多行编号列表，原样打印会把一条日志切成多行）。
 */
export declare function summarizeHookReason(reason: string | undefined): string | undefined;
