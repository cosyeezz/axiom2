/**
 * LeaveWorktree Agent Tool
 *
 * 允许 Agent 在会话中离开当前 worktree 并切换回原始工作目录。
 * 与 EnterWorktree 对称，确保 worktree 生命周期完整闭环。
 *
 * 没有这个 Tool，Agent 完成工作后只能用 Bash 自行组装 git 命令清理 worktree，
 * 会导致会话状态、工作目录、分支等清理不干净。
 */
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { Tool, ToolResult } from './tool-protocol';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
/**
 * LeaveWorktree 工具参数 schema
 */
declare const LeaveWorktreeParameters: z.ZodObject<{
    action: z.ZodOptional<z.ZodEnum<["keep", "remove"]>>;
    force: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    force?: boolean | undefined;
    action?: "keep" | "remove" | undefined;
}, {
    force?: boolean | undefined;
    action?: "keep" | "remove" | undefined;
}>;
type LeaveWorktreeInput = z.infer<typeof LeaveWorktreeParameters>;
export declare class LeaveWorktreeTool extends BaseTool implements Tool {
    name: ToolNames;
    description: string;
    aliases: string[];
    parameters: z.ZodObject<{
        action: z.ZodOptional<z.ZodEnum<["keep", "remove"]>>;
        force: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        force?: boolean | undefined;
        action?: "keep" | "remove" | undefined;
    }, {
        force?: boolean | undefined;
        action?: "keep" | "remove" | undefined;
    }>;
    private worktreeSessionManager;
    private worktreeChangeDetector?;
    /**
     * 权限：始终需要用户确认
     * 原因：会改变进程工作目录，影响后续所有操作
     */
    needsApproval: boolean;
    /**
     * 执行离开 worktree
     */
    execute(input: LeaveWorktreeInput): Promise<ToolResult>;
}
export {};
