import { Logger } from '@genie/telemetry';
import { MemoryManager } from '../../memory';
export declare const AutoModeProjectInstructionsResolver: unique symbol;
/**
 * Resolves the CODEBUDDY.md / rule-layer text injected into the classifier as a
 * separate user context message (decision D2, aligned with Claude's CLAUDE.md
 * injection).
 *
 * The text is framed in the classifier client as context about user intent — it
 * may authorize the SPECIFIC action under review, but generic encouragement is
 * never authorization. We therefore only need to surface the rule-layer content;
 * the "not a blanket grant" framing lives in the prompt wrapper.
 *
 * Sources: USER + PROJECT scoped memory (the CODEBUDDY.md rule layer). We do NOT
 * include the auto-memory directory or PROJECT_LOCAL here — only the instruction
 * layer the user authored as project/user guidance.
 */
export interface AutoModeProjectInstructionsResolver {
    /** Combined rule-layer text, or empty string when none is configured. */
    resolve(): Promise<string>;
}
export declare class AutoModeProjectInstructionsResolverImpl implements AutoModeProjectInstructionsResolver {
    protected readonly memoryManager?: MemoryManager;
    protected readonly logger: Logger;
    resolve(): Promise<string>;
}
