import { PromptManager } from '@genie/prompts';
import { AutoModeRules } from './auto-mode-protocol';
export declare const AutoModeSystemPromptBuilder: unique symbol;
/**
 * Assembles the classifier system prompt by substituting resolved rules and the
 * user's `permissions.deny` rules into the framework template.
 *
 * Mirrors Claude Code 2.1.179: the framework lives in the template with
 * `<user_*_to_replace>` and `<settings_deny_rules>` placeholders; the rule lists
 * and deny-rule section are injected at call time (binary `Pb_` / `QLK`). The
 * framework text (Default Rule / Scope / User Intent Rule / Evaluation Rules /
 * Classification Process / Definitions / Output Format) is NOT duplicated here.
 */
export interface AutoModeSystemPromptBuilder {
    build(rules: AutoModeRules, settingsDenyRules: string[]): Promise<string>;
}
export declare class AutoModeSystemPromptBuilderImpl implements AutoModeSystemPromptBuilder {
    protected readonly promptManager: PromptManager;
    build(rules: AutoModeRules, settingsDenyRules: string[]): Promise<string>;
    /** Replace `<tag>...</tag>` (default content included) with the formatted rule list. */
    private replaceTag;
    /**
     * Render the user's `permissions.deny` rules as a classifier instruction
     * (binary `QLK`): list the deny rules and tell the classifier to catch
     * circumvention via a different tool. Empty when there are no deny rules.
     */
    private renderSettingsDenyRules;
}
