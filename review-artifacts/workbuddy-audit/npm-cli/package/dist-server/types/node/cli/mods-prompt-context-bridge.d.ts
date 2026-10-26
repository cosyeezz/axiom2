import type { ModsBridge, ModsPromptSubmitResult, PromptContext } from '../../vendor/cbc-core/node/index.js';
import { Mods } from '../../vendor/cbc-plugins/node/index.js';
import type { AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
/** What `command.describe` hooks answered for `/name`, for the typeahead and /help to show. */
export declare function describedCommand(name: string): {
    description: string;
    argumentHint?: string;
    isHidden: boolean;
} | undefined;
/**
 * 建一个把 core 的上下文送进 mods 引擎、再把结果写回来的桥。
 *
 * @param runtime 已启动的 mods 运行时
 */
export declare function createModsBridge(runtime: Mods.ModsRuntime): {
    promptContext(context: PromptContext): Promise<PromptContext>;
    promptSubmit(input: {
        text: string;
        sessionId?: string;
        signal?: AbortSignal;
    }): Promise<ModsPromptSubmitResult | undefined>;
    sessionStart(input: {
        cwd: string;
        isInteractive: boolean;
    }): Promise<void>;
    pushModLog(text: string, meta: {
        plugin: string;
    }): void;
    sessionAppend(item: AgentInputItem, session: {
        readonly id: string;
        readonly parentSessionId?: string;
        readonly model?: string;
    }): Promise<void>;
    sessionEnd(input: {
        reason: string;
        sessionId: string;
        resume: {
            id: string;
        };
    }): Promise<void>;
    sessionCompact(input: {
        trigger: 'manual' | 'auto';
        instructions?: string;
        agentId?: string;
        history: readonly AgentInputItem[];
    }): Promise<{
        instructions?: string;
        skip?: string;
    } | undefined>;
    toolCall: ModsBridge['toolCall'];
};
