import { PromptManager } from '@genie/prompts';
import { AutoModeSettings } from '../../settings';
import { AutoModeRules } from './auto-mode-protocol';
import { AutoModeSystemPromptBuilder } from './auto-mode-system-prompt-builder';
export declare const AutoModeCritiqueClient: unique symbol;
/** True if any section has a custom entry beyond the `$defaults` token (Claude `is6`). */
export declare function hasCustomRules(raw: AutoModeSettings | undefined): boolean;
/**
 * Runs the auto mode rule critique (read-only).
 *
 * Implementation: spawns a standard `codebuddy -p` (print/headless) subprocess.
 * This reuses the project's canonical "cold-start, run once, exit" path — the
 * child waits for its own runtime to be fully ready, so the critique command
 * never races agent registration during startup (which a direct in-process
 * `runOneTime` would, since this runs from a short-lived dispatch strategy).
 *
 * Prompt / context assembly is aligned with Claude Code 2.1.179 `MIT`/`rs6`:
 *  - system prompt = the "expert reviewer" critique instructions template
 *  - the user message embeds the FULL classifier system prompt plus the user's
 *    custom rules, each section annotated as replacing or extending the defaults
 *  - only the user's CUSTOM rules are reviewed (the strategy gates on
 *    `hasCustomRules` before calling this)
 *
 * Does not participate in permission decisions.
 */
export declare class AutoModeCritiqueClientImpl {
    protected readonly systemPromptBuilder: AutoModeSystemPromptBuilder;
    protected readonly promptManager: PromptManager;
    /**
     * @param resolved  effective rules after `$defaults` expansion — used to render
     *                  the classifier system prompt the critique reviews against.
     * @param raw       merged-but-unexpanded custom rules (`$defaults` preserved) —
     *                  used to show only the user's own entries with replace/extend
     *                  annotations.
     */
    critique(resolved: AutoModeRules, raw: AutoModeSettings): Promise<string>;
    /** Load the critique "expert reviewer" system prompt template text. */
    private loadCritiqueSystemPrompt;
    /**
     * Spawn `codebuddy -p --model lite --system-prompt <critique> -` with the
     * critique user message on stdin, and return the printed text.
     */
    private runPrintSubprocess;
    protected buildCritiqueInput(resolved: AutoModeRules, raw: AutoModeSettings): Promise<string>;
    /**
     * Format one section's custom rules, noting whether they extend (contain
     * `$defaults`) or replace the built-in defaults. Mirrors Claude `rs6`.
     * Returns '' when the section has no custom entries.
     */
    private formatSection;
}
