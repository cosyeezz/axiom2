/**
 * Memory Extraction Stop Hook
 *
 * 在主 agent 完成回复后触发记忆提取。
 * 与 Claude Code 的 executeExtractMemories 在 handleStopHooks 中的行为对齐。
 *
 * 交互模式: fire-and-forget，不阻塞 UI
 * Headless模式: await 提取完成，确保进程退出前提取执行完毕
 */
import { Hook, HookInput, HookPriority } from '../hooks/hook-protocol';
import { HookEvent, HookExecutionResult } from '../../vendor/cbc-shared/node/index.js';
import { MemoryExtractionService } from './memory-extraction-service';
export declare class MemoryExtractionStopHook implements Hook {
    readonly event = HookEvent.STOP;
    readonly priority = HookPriority.Low;
    protected readonly extractionService?: MemoryExtractionService;
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
}
