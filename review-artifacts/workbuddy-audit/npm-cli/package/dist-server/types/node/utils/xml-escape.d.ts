/**
 * Escape `&` `<` `>` `"` for task-notification attributes / text.
 * Decode is intentionally not supported — only the encode path is used.
 */
export declare function escapeXml(text: string): string;
