/**
 * WorkflowBackgroundTaskTracker —— 把后台 workflow run 接入 BackgroundTask 通知通道。
 *
 * WorkflowTool 与 `/deep-research` 等命令共用:注册 BackgroundTask(task.id == runId,
 * TaskOutput 可按 runId 查) → done 时落盘 output、翻终态、推 `<task-notification>`。
 *
 * `showResultInChat`:命令入口没有模型在等结果,交互式 TUI 下把最终结果原样写进对话流,
 * 通知改为 deferDrain(模型在下次用户输入时知道任务已结束),不再额外烧一轮模型复述。
 * 非交互路径(ACP / stream-json / print)不写历史,照常 drain 让主 agent 转述结果。
 *
 * 不进 tools barrel:只被 workflow-tool / deep-research-command-executor 引用,
 * lite-wb 把这两个入口 alias 掉后本文件随之出图(见 hooks/webpack-lite-wb.ts)。
 */
import { BackgroundTask, Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { type WorkflowManager, type WorkflowStartHandle } from '@genie/cbc-workflow';
import { Logger } from '@genie/telemetry';
import { AgentTaskOutputFileManager, BackgroundTaskNotifier } from '../agent-task/agent-task-protocol';
export interface WorkflowBackgroundTaskOptions {
    /** 透传给 BackgroundTaskNotifier 拼 `<tool-use-id>`;命令入口无此值 */
    toolUseId?: string;
    /** 交互式 TUI 下把最终结果原样写进对话流(命令入口用) */
    showResultInChat?: boolean;
}
export declare class WorkflowBackgroundTaskTracker {
    protected readonly logger: Logger;
    protected readonly manager: WorkflowManager;
    protected readonly backgroundTaskNotifier: BackgroundTaskNotifier;
    protected readonly outputFileManager: AgentTaskOutputFileManager;
    protected readonly sessionManager: SessionManager;
    /**
     * 注册 BackgroundTask 并挂上 done 收口(fire-and-forget,不 await done)。
     */
    track(session: Session, handle: WorkflowStartHandle, options?: WorkflowBackgroundTaskOptions): BackgroundTask;
    /**
     * 把 workflow run 注册到 ToolManager 的后台任务池。
     * - task.id 复用 runId,让 TaskOutput 能直接按 task_id 查到
     * - stdout/stderr 留空 buffer:workflow 没有流式输出,但接口要求非空
     * - kill wire 到 manager.abort,让模型/UI 调 KillBash 之类等价操作能终止 workflow
     * - toolName 固定为 Workflow,notifier 据此输出 "Dynamic workflow" 文案
     */
    private registerBackgroundTask;
    /**
     * Workflow 完成 / 失败 / abort 时:
     *   1. 把 record.output 落盘到用户隔离临时目录的 agent-tasks/<runId>.output
     *   2. 翻 task 状态,通知 UI 更新
     *   3. 调 BackgroundTaskNotifier 推 `<task-notification>` 给主 agent
     */
    private finalizeBackgroundTask;
    /**
     * 把最终结果作为命令输出写进对话流。失败自吞并返回 false,回退为常规通知 drain,
     * 保证结果至少能经主 agent 送达。
     */
    private appendResultToChat;
}
