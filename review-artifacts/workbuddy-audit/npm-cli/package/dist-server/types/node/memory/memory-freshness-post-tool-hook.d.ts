/**
 * Memory Freshness PostToolUse Hook
 *
 * 当 Read 工具读取记忆目录中的文件时，自动在 response 末尾追加陈旧警告。
 * 与 Claude Code FileReadTool 中的 memoryFreshnessNote 对齐。
 *
 * 触发条件：PostToolUse + matcher="Read" + file_path 在 memory 目录内
 */
import { Logger } from '@genie/telemetry';
import { Hook, HookInput, HookPriority } from '../hooks/hook-protocol';
import { HookEvent, HookExecutionResult } from '../../vendor/cbc-shared/node/index.js';
export declare class MemoryFreshnessPostToolHook implements Hook {
    readonly event = HookEvent.POST_TOOL_USE;
    readonly priority = HookPriority.Normal;
    readonly matcher = "Read";
    protected readonly logger: Logger;
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
    /**
     * 检查文件路径是否在记忆目录中
     */
    private isMemoryPath;
}
