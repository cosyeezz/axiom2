/**
 * EnterWorktree Agent Tool
 *
 * 允许 Agent 在会话中动态创建 git worktree 并切换到其中。
 * 这是 worktree 功能的核心交互入口，Agent 可以根据用户自然语言请求自主调用。
 *
 * 没有这个 Tool 注册，Agent 遇到 "start a worktree" 请求时不知道有 worktree 工具可用，
 * 会尝试用 Bash 自行组装 git 命令，产生完全不同的（错误的）用户体验。
 */
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { Tool, ToolResult } from './tool-protocol';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
/**
 * EnterWorktree 工具参数 schema
 */
declare const EnterWorktreeParameters: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    branch: z.ZodOptional<z.ZodString>;
    path: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    branch?: string | undefined;
    name?: string | undefined;
    path?: string | undefined;
}, {
    branch?: string | undefined;
    name?: string | undefined;
    path?: string | undefined;
}>;
type EnterWorktreeInput = z.infer<typeof EnterWorktreeParameters>;
export declare class EnterWorktreeTool extends BaseTool implements Tool {
    name: ToolNames;
    description: string;
    aliases: string[];
    parameters: z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        branch: z.ZodOptional<z.ZodString>;
        path: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        branch?: string | undefined;
        name?: string | undefined;
        path?: string | undefined;
    }, {
        branch?: string | undefined;
        name?: string | undefined;
        path?: string | undefined;
    }>;
    private worktreeSessionManager;
    /**
     * 权限：始终需要用户确认
     * 原因：会改变进程工作目录，影响后续所有操作
     */
    needsApproval: boolean;
    /**
     * 执行 worktree 创建
     */
    execute(input: EnterWorktreeInput): Promise<ToolResult>;
}
export {};
