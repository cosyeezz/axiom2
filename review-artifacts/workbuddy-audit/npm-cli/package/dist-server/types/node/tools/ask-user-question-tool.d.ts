import { Session } from '../../vendor/cbc-core/node/index.js';
import { type FunctionCallItem, type ToolExecuteArgument, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Workspace } from '@genie/runtime';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { AskService } from '../ask';
import { SdkHooksManager } from '../control-signal/control-signal-protocol';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
/**
 * Normalize AskUserQuestion input to handle common model mistakes:
 * - Using "answers" field instead of "options"
 * - Passing plain string arrays instead of {label, description} objects
 * - Missing "header" field
 *
 * Call this before passing input to UI layers or tool execution.
 */
export declare function normalizeAskUserQuestionInput(input: Record<string, any>): Record<string, any>;
declare const AskUserQuestionParameters: z.ZodEffects<z.ZodObject<{
    questions: z.ZodArray<z.ZodObject<{
        question: z.ZodString;
        header: z.ZodString;
        options: z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            description: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            description: string;
            label: string;
        }, {
            description: string;
            label: string;
        }>, "many">;
        multiSelect: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        question: string;
        options: {
            description: string;
            label: string;
        }[];
        header: string;
        multiSelect: boolean;
    }, {
        question: string;
        options: {
            description: string;
            label: string;
        }[];
        header: string;
        multiSelect?: boolean | undefined;
    }>, "many">;
    answers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    metadata: z.ZodOptional<z.ZodObject<{
        source: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        source?: string | undefined;
    }, {
        source?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    questions: {
        question: string;
        options: {
            description: string;
            label: string;
        }[];
        header: string;
        multiSelect: boolean;
    }[];
    metadata?: {
        source?: string | undefined;
    } | undefined;
    answers?: Record<string, string> | undefined;
}, {
    questions: {
        question: string;
        options: {
            description: string;
            label: string;
        }[];
        header: string;
        multiSelect?: boolean | undefined;
    }[];
    metadata?: {
        source?: string | undefined;
    } | undefined;
    answers?: Record<string, string> | undefined;
}>, {
    questions: {
        question: string;
        options: {
            description: string;
            label: string;
        }[];
        header: string;
        multiSelect: boolean;
    }[];
    metadata?: {
        source?: string | undefined;
    } | undefined;
    answers?: Record<string, string> | undefined;
}, {
    questions: {
        question: string;
        options: {
            description: string;
            label: string;
        }[];
        header: string;
        multiSelect?: boolean | undefined;
    }[];
    metadata?: {
        source?: string | undefined;
    } | undefined;
    answers?: Record<string, string> | undefined;
}>;
export declare class AskUserQuestionTool extends BaseTool implements Tool {
    protected readonly workspace: Workspace;
    protected readonly askService: AskService;
    protected readonly sdkHooksManager: SdkHooksManager;
    name: ToolNames;
    description: string;
    parameters: z.ZodEffects<z.ZodObject<{
        questions: z.ZodArray<z.ZodObject<{
            question: z.ZodString;
            header: z.ZodString;
            options: z.ZodArray<z.ZodObject<{
                label: z.ZodString;
                description: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                description: string;
                label: string;
            }, {
                description: string;
                label: string;
            }>, "many">;
            multiSelect: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            question: string;
            options: {
                description: string;
                label: string;
            }[];
            header: string;
            multiSelect: boolean;
        }, {
            question: string;
            options: {
                description: string;
                label: string;
            }[];
            header: string;
            multiSelect?: boolean | undefined;
        }>, "many">;
        answers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        metadata: z.ZodOptional<z.ZodObject<{
            source: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            source?: string | undefined;
        }, {
            source?: string | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        questions: {
            question: string;
            options: {
                description: string;
                label: string;
            }[];
            header: string;
            multiSelect: boolean;
        }[];
        metadata?: {
            source?: string | undefined;
        } | undefined;
        answers?: Record<string, string> | undefined;
    }, {
        questions: {
            question: string;
            options: {
                description: string;
                label: string;
            }[];
            header: string;
            multiSelect?: boolean | undefined;
        }[];
        metadata?: {
            source?: string | undefined;
        } | undefined;
        answers?: Record<string, string> | undefined;
    }>, {
        questions: {
            question: string;
            options: {
                description: string;
                label: string;
            }[];
            header: string;
            multiSelect: boolean;
        }[];
        metadata?: {
            source?: string | undefined;
        } | undefined;
        answers?: Record<string, string> | undefined;
    }, {
        questions: {
            question: string;
            options: {
                description: string;
                label: string;
            }[];
            header: string;
            multiSelect?: boolean | undefined;
        }[];
        metadata?: {
            source?: string | undefined;
        } | undefined;
        answers?: Record<string, string> | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    isEnabled: (args: {
        runContext: RunContext<Session>;
    }) => boolean;
    needsApproval: (_runContext: RunContext<Session>, input: ToolExecuteArgument<any>, _callId?: string) => Promise<boolean>;
    execute(input: z.infer<typeof AskUserQuestionParameters>, context?: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    /**
     * 把 execute 捕获的异常映射到结构化错误码：
     * - ToolExecutionError：保留其码（missing toolCallId=19201 / no answers=19202）
     * - acquireAnswers 超时（'timed out'）→ ToolTimeoutError(90003)
     * - 中断/abort（'Aborted'）→ ToolCancelledError(90004)
     * - 其余（rejectAsk 的 'User declined'）→ AskFollowupUserDeclinedError(19204)
     */
    private resolveAskErrorCode;
}
export {};
