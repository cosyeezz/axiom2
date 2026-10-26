import type { Logger } from '@celljs/core';
import { type AgentInputItem } from '../../../cbc-shared/node/index.js';
/** 原文无法找回时交给模型的说明，避免模型把空结果当成工具真的什么都没返回。 */
export declare const LOST_TOOL_OUTPUT_PLACEHOLDER = "[Tool output was lost due to a client error. Re-run the tool if its result is needed.]";
/**
 * Sanitize the `content[].type` field of message items in a history array.
 *
 * Why this exists:
 *   The OpenAI agents SDK (`@openai/agents-openai`) performs exhaustive validation on
 *   content block types. The only legal types are:
 *     - assistant role: `output_text` / `refusal` / `audio` / `image`
 *     - user role:      `input_text` / `input_image` / `input_file` / `audio`
 *
 *   However, certain legacy paths (notably `@genie/history-migration`'s
 *   `data-converter.ts:1053`) have written `{ type: 'text' }` into session JSONL.
 *   When such an item reaches the SDK converter, it throws:
 *     `Unknown content: {"type":"text","text":"<summary>..."}`
 *
 *   This function is the load-time safety net: after JSONL is read off disk and
 *   before the history enters any downstream pipeline (interceptors / SDK / replay),
 *   we fix any stray `{ type: 'text' }` to the role-appropriate legal type.
 *
 * Rules:
 *   - assistant role: `{type:'text'}` → `{type:'output_text'}`
 *   - user role:      `{type:'text'}` → `{type:'input_text'}`
 *   - system role:    untouched (its `content` is schema-typed as `string`, never an array)
 *   - function_call_result `output: {type:'text'}` without a string `text` (written by the
 *     tickets#16172 double-normalization bug) → restore `text` from
 *     `providerData.toolResult.content`, or a lost-output placeholder (the bug usually erased
 *     both copies). Not persisted; repaired on each load. Otherwise the SDK chat-completions
 *     converter throws `Only text tool outputs are supported` on every replay of the session.
 *   - other types and non-message items: untouched
 *
 * Properties:
 *   - Pure function; no I/O, no mutation of inputs (items with changes are shallow-cloned).
 *   - Idempotent: already-legal types stay as is; running twice yields the same result.
 *   - Safe on malformed items: missing/non-array `content` is returned untouched.
 *
 * See: apps/workbuddy-desktop/docs/refactor/migration/21-content-block-type-sanitization.md
 */
export declare function sanitizeContentBlockTypes(history: AgentInputItem[], logger?: Logger): AgentInputItem[];
//# sourceMappingURL=content-block-sanitizer.d.ts.map