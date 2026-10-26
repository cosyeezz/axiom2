import { AutoModeRules } from './auto-mode-protocol';
/**
 * Built-in default auto mode rules — single source of truth.
 *
 * Ported VERBATIM from Claude Code 2.1.179 `auto-mode defaults` with only
 * product-specific substitutions (Claude -> CodeBuddy, ~/.claude -> ~/.codebuddy,
 * .claude/ -> .codebuddy/, CLAUDE.md -> CODEBUDDY.md). The security wording is
 * intentionally NOT summarised or trimmed: the classifier is an LLM that reads
 * these as policy, so every qualifying clause changes its judgement. The only
 * deliberate divergence is the "CodeBuddy Scheduling" allow rule, narrowed
 * because CodeBuddy has no RemoteTrigger / cloud routine registration (see note).
 *
 * Consumed by: the classifier prompt builder AND `codebuddy auto-mode defaults`
 * (Phase 3 CLI) — both must read from here to avoid doc/runtime drift.
 */
export declare const AUTO_MODE_DEFAULTS: AutoModeRules;
