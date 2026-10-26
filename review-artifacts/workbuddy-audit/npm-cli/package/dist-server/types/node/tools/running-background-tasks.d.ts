import type { AgentTask, AgentTaskManager } from '../agent-task/agent-task-protocol';
/**
 * 当前可作为 `task_id` 使用的后台任务，格式为 `id (类型: 标题)`。
 *
 * 为什么需要它：`TaskStop` / `TaskOutput` 的 not-found 文案原本让模型「用 /tasks 看看」，
 * 但 `/tasks` 是 TUI 面板路由（键盘进入、渲染给人看），对应的 CommandExecutor.execute()
 * 函数体是空的，不产出任何进入对话的文本 —— 模型既调不到也读不到。拿不到候选就只能猜
 * task_id：线上实测出现过 TaskStop 连续枚举 488 个不同 id 的失控循环（循环检测按
 * name+arguments 完全相同计数，参数每次都变所以拦不住，最后靠 Max turns (500) 才停，
 * 耗掉 725 credits）。把候选直接拼进错误文本是消除猜测动机的关键 —— 与 Claude Code 的
 * `nTa()` 同一思路：错误信号和可用候选在同一次工具结果里给齐。
 *
 * 口径与 `/tasks` 面板（ui/input/panel/tasks/tasks-panel.tsx）保持一致：同样的两个
 * registry、同样只列 running/pending、agent task 同样用 `agentType › description`
 * 三级兜底标题 —— 否则同一个任务在面板和这里显示的名字会不一样。
 */
export declare function listRunningBackgroundTasks(agentTaskManager: AgentTaskManager): string[];
/** agent task 的展示名，与 /tasks 面板及 TaskStop.stopAgentTask 同一套兜底顺序。 */
export declare function describeAgentTask(task: AgentTask): string;
/**
 * 目标 task_id 不存在时给模型的完整消息：说明找不到，并列出当前可用的候选。
 *
 * `TaskStop` 与 `TaskOutput` 共用 —— 两者都接受同一个 `task_id`、都在同样的两个
 * registry 里查找，因此候选集合必须一致；分头维护迟早会漂移。
 */
export declare function buildNotFoundMessage(taskId: string, agentTaskManager: AgentTaskManager): string;
