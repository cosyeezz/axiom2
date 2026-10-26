export declare const ASK_USER_QUESTION_SHAPE_HINT = "Expected shape: {\"questions\": [{\"question\": \"...\", \"header\": \"...\", \"options\": [{\"label\": \"...\", \"description\": \"...\"}, {\"label\": \"...\", \"description\": \"...\"}]}]}.";
/**
 * Copy-paste payload for REPL / Code Mode. Catalog schema collapses `questions`
 * to `object`; without this the model returns a placeholder string instead of
 * calling the sandbox global.
 */
export declare const ASK_USER_QUESTION_CALL_EXAMPLE = "AskUserQuestion({ questions: [{ question: \"Which approach?\", header: \"Approach\", options: [{ label: \"Explore first\", description: \"Read the code\" }, { label: \"Try it\", description: \"Run the CLI\" }] }] })";
/**
 * Validate AskUserQuestion params before normalization / UI rendering.
 *
 * Enforces only required fields, types, >= 1 non-empty option label, and
 * unique question texts / option labels (both are answer-map keys). Count /
 * length limits (minItems >= 2, maxItems, maxLength) are NOT enforced — per
 * issue #63973 they aren't runtime constraints, so blocking rejects valid
 * calls (e.g. a single-option question).
 *
 * Multiple issues are aggregated (Read-tool error format) so the model can fix
 * everything in one round-trip.
 *
 * @returns the error message, or `undefined` when params are valid.
 */
export declare function validateAskUserQuestionParams(input: any): string | undefined;
