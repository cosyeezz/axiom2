/**
 * ChannelTasks —— 频道任务板（黑板 + 单写者认领）。
 *
 * 事件经 applyChannelTaskEvent 落板 + transcript（kind=task），再定向叫醒。
 * 纪律：先 claim 再动手；产出写文件 / 分支，refs 只传引用不贴正文。
 * 只对 Agent Home 自治表面开放（TUI / 通用 ACP / 子代理拿不到）。
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { RunContext } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { z } from 'zod';
import { ChannelWakeService } from '../agent-home/channel-wake-service';
import { SettingsManager } from '../settings/settings-protocol';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolNames, ToolResult } from './tool-protocol';
export declare class ChannelTasksTool extends BaseTool implements Tool {
    protected readonly logger: Logger;
    protected readonly wakeService?: ChannelWakeService;
    protected readonly settingsManager?: SettingsManager;
    name: ToolNames;
    description: string;
    needsApproval: boolean;
    shouldShowInToolSearch: () => boolean;
    parameters: z.ZodObject<{
        action: z.ZodEnum<["list", "create", "update", "delete", "claim", "complete", "release", "dispatch", "escalate"]>;
        channel: z.ZodOptional<z.ZodString>;
        taskId: z.ZodOptional<z.ZodString>;
        subject: z.ZodOptional<z.ZodString>;
        detail: z.ZodOptional<z.ZodString>;
        assignAgentId: z.ZodOptional<z.ZodString>;
        refs: z.ZodOptional<z.ZodArray<z.ZodObject<{
            kind: z.ZodEnum<["issue", "file", "pr", "commit", "url"]>;
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            kind: "file" | "url" | "commit" | "pr" | "issue";
        }, {
            value: string;
            kind: "file" | "url" | "commit" | "pr" | "issue";
        }>, "many">>;
        requestId: z.ZodOptional<z.ZodString>;
        assignments: z.ZodOptional<z.ZodArray<z.ZodObject<{
            subject: z.ZodString;
            detail: z.ZodOptional<z.ZodString>;
            assignAgentId: z.ZodString;
            refs: z.ZodOptional<z.ZodArray<z.ZodObject<{
                kind: z.ZodEnum<["issue", "file", "pr", "commit", "url"]>;
                value: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                value: string;
                kind: "file" | "url" | "commit" | "pr" | "issue";
            }, {
                value: string;
                kind: "file" | "url" | "commit" | "pr" | "issue";
            }>, "many">>;
        }, "strip", z.ZodTypeAny, {
            subject: string;
            assignAgentId: string;
            detail?: string | undefined;
            refs?: {
                value: string;
                kind: "file" | "url" | "commit" | "pr" | "issue";
            }[] | undefined;
        }, {
            subject: string;
            assignAgentId: string;
            detail?: string | undefined;
            refs?: {
                value: string;
                kind: "file" | "url" | "commit" | "pr" | "issue";
            }[] | undefined;
        }>, "many">>;
        escalate: z.ZodOptional<z.ZodObject<{
            mode: z.ZodEnum<["nudge", "release"]>;
            taskIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            maxStaleMs: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            mode: "release" | "nudge";
            taskIds?: string[] | undefined;
            maxStaleMs?: number | undefined;
        }, {
            mode: "release" | "nudge";
            taskIds?: string[] | undefined;
            maxStaleMs?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        action: "list" | "delete" | "create" | "complete" | "update" | "release" | "dispatch" | "claim" | "escalate";
        detail?: string | undefined;
        requestId?: string | undefined;
        subject?: string | undefined;
        channel?: string | undefined;
        taskId?: string | undefined;
        refs?: {
            value: string;
            kind: "file" | "url" | "commit" | "pr" | "issue";
        }[] | undefined;
        escalate?: {
            mode: "release" | "nudge";
            taskIds?: string[] | undefined;
            maxStaleMs?: number | undefined;
        } | undefined;
        assignAgentId?: string | undefined;
        assignments?: {
            subject: string;
            assignAgentId: string;
            detail?: string | undefined;
            refs?: {
                value: string;
                kind: "file" | "url" | "commit" | "pr" | "issue";
            }[] | undefined;
        }[] | undefined;
    }, {
        action: "list" | "delete" | "create" | "complete" | "update" | "release" | "dispatch" | "claim" | "escalate";
        detail?: string | undefined;
        requestId?: string | undefined;
        subject?: string | undefined;
        channel?: string | undefined;
        taskId?: string | undefined;
        refs?: {
            value: string;
            kind: "file" | "url" | "commit" | "pr" | "issue";
        }[] | undefined;
        escalate?: {
            mode: "release" | "nudge";
            taskIds?: string[] | undefined;
            maxStaleMs?: number | undefined;
        } | undefined;
        assignAgentId?: string | undefined;
        assignments?: {
            subject: string;
            assignAgentId: string;
            detail?: string | undefined;
            refs?: {
                value: string;
                kind: "file" | "url" | "commit" | "pr" | "issue";
            }[] | undefined;
        }[] | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    toAutoClassifierInput(_input: unknown): string;
    isEnabled: (args?: {
        runContext?: RunContext<Session>;
        agent?: {
            name?: string;
        };
    }) => Promise<boolean>;
    execute(input: {
        action?: string;
        channel?: string;
        taskId?: string;
        subject?: string;
        detail?: string;
        assignAgentId?: string;
        refs?: {
            kind: 'issue' | 'file' | 'pr' | 'commit' | 'url';
            value: string;
        }[];
        requestId?: string;
        assignments?: {
            subject: string;
            detail?: string;
            assignAgentId: string;
            refs?: {
                kind: 'issue' | 'file' | 'pr' | 'commit' | 'url';
                value: string;
            }[];
        }[];
        escalate?: {
            mode: 'nudge' | 'release';
            taskIds?: string[];
            maxStaleMs?: number;
        };
    }, context?: RunContext<Session>): Promise<ToolResult>;
}
