/**
 * Terminal Title User Prompt Hook
 *
 * Internal Hook implementation that triggers session title generation
 * when user submits a prompt. Delegates to SessionTitleService for
 * count=1 / count=3 limited-run AI title generation.
 */
import { HookEvent, HookExecutionResult } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { Hook, HookInput, HookPriority } from '../hooks/hook-protocol';
export declare class TerminalTitleUserPromptHook implements Hook {
    readonly event = HookEvent.USER_PROMPT_SUBMIT;
    readonly priority = HookPriority.Lowest;
    protected readonly sessionTitleService: InstanceType<typeof import('../session-title/session-title-service.js').SessionTitleServiceImpl>;
    protected readonly logger: Logger;
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
}
