/**
 * Markdown code-span detection shared by `@path` reference scanners
 * (agent-cli `ImportUtils` and resource reporting), so both agree on which
 * mentions are real references.
 *
 * Rule: a position is inside code when an odd number of ``` fences, or of lone
 * ` ticks (not part of a ``` run), precedes it.
 */
export declare function isInMarkdownCode(text: string, position: number): boolean;
/**
 * Same rule as {@link isInMarkdownCode}, with the counts accumulated in one
 * forward pass. Query positions in ascending order; a text with many mentions
 * is then scanned once instead of once per mention.
 */
export declare function markdownCodeTester(text: string): (position: number) => boolean;
//# sourceMappingURL=markdown-code-utils.d.ts.map