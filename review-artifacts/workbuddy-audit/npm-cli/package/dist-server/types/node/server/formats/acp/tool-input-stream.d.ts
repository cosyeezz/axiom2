import type { SensitiveProtectionMetadata } from '../../../sensitive-content/sensitive-content-protocol';
/**
 * Ranges describe the compact JSON representation of rawInput. The streaming
 * parser may only have appended closing delimiters; then the source is still a
 * prefix and offsets remain exact. For JSON normalization/escapes or string
 * fallbacks, use the existing whole-value mask rather than guessing offsets.
 * Never change the input value or put arguments in tool-output content.
 */
export declare function projectToolInputProtection(text: string, rawInput: unknown, candidate: unknown): SensitiveProtectionMetadata | undefined;
/** One tool's existing JSON parser plus range metadata; no second input buffer. */
export declare class ToolInputStream {
    private readonly parser;
    private protection?;
    append(delta: string, candidate: unknown): {
        rawInput: unknown;
        sensitiveProtection?: SensitiveProtectionMetadata;
    };
    /** Final arguments replace the partial value and, when supplied, its protection. */
    complete(text: string, candidate: unknown): {
        rawInput: unknown;
        sensitiveProtection: SensitiveProtectionMetadata | null;
    };
}
