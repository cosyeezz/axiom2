import { type BackgroundTask, type Session } from '../../vendor/cbc-core/node/index.js';
import { BackgroundTaskNotifier } from '../agent-task/agent-task-protocol';
import { type ToolManager as IToolManager } from '../tools/tool-protocol';
import { type AcpTerminalPublisher } from './acp-protocol';
/**
 * 客户端主动取消后台任务。
 *
 * 为什么是私有 extMethod 而不是标准 ACP 报文：ACP v2 的 terminal-output 是**只读展示面**，
 * RFD 明文写着它不给客户端任何控制权（"It does not let the Client write input, resize,
 * interrupt, kill, wait on, or release the Agent's process."）。v1 虽然有 `terminal/kill`，
 * 但那套终端是**客户端拥有**的、由 agent 去调，所有权方向正好相反。所以"客户端要求
 * agent 停掉自己的进程"这件事在标准协议里没有位置，只能走 `_codebuddy.ai/` 私有方法。
 *
 * ## 为什么叫 cancel 而不是 delete
 *
 * 对齐 MCP Tasks 扩展（SEP 2663）的模型：它只有 `tasks/cancel`，**没有** `tasks/delete`，
 * 把"停掉工作"和"清掉记录"刻意分成两件事——取消只负责终止执行，记录由保留期自动回收。
 *
 * 这个划分对我们有实际好处：取消之后任务仍留在 ToolManager 的注册表里（直到它现有的
 * 5 分钟 TTL 淘汰终态任务），于是
 * - `session-replay` 刷新时仍会补发这个终端的状态快照，**漏收了取消广播的第二个客户端
 *   刷新后看到的是「已取消」，而不是一张幻影的「运行中」卡片**；
 * - 模型在 TTL 内仍能用 `TaskOutput` 追溯这个任务的输出。
 *
 * 代价是本方法**不负责让卡片从界面上消失** —— 那是纯客户端的视图状态，归客户端自己管
 * （MCP 同样把这件事交给客户端：规范允许客户端一发出取消就立刻丢掉本地状态，不必等
 * 终态确认）。
 *
 * ## 与 MCP 的两处刻意分歧
 *
 * 1. MCP 的 `tasks/cancel` 回**空 ack**，因为它的取消是"协作式"的——服务端只承诺收到，
 *    不承诺真停。我们的 kill 是同步的、当场就知道成没成，把这个信息丢掉反而是退步，
 *    所以回一个 outcome 四态。
 * 2. MCP 对未知 taskId 建议回 JSON-RPC `-32602`。我们把"找不到"放在 result 里：本方法的
 *    调用方是 UI 交互，前端要靠它收敛卡片状态，而 MCP 那条是 SHOULD 且它的调用方是轮询
 *    逻辑。**这是有意的，不是漏了 -32602。**
 */
/** 方法名。走 `_codebuddy.ai/` 前缀，不占用标准 `session/*` 命名空间。 */
export declare const CANCEL_BACKGROUND_TASK_METHOD = "_codebuddy.ai/session/cancelBackgroundTask";
export type CancelBackgroundTaskOutcome = 
/** 本次真的停掉了一个运行中的任务。 */
'cancelled'
/** 任务已是终态，无事可做。不是错误。 */
 | 'already_exited'
/** 该会话下没有这个 terminalId（含被 TTL 淘汰、含跨会话越权尝试）。 */
 | 'not_found'
/** kill 抛异常，进程大概率还在跑。 */
 | 'cancel_failed';
export interface CancelBackgroundTaskResult {
    outcome: CancelBackgroundTaskOutcome;
    terminalId: string;
}
export interface CancelBackgroundTaskDeps {
    session: Session;
    terminalId: string;
    logger?: {
        info?: (msg: string) => void;
        warn?: (msg: string) => void;
        debug?: (msg: string) => void;
    };
    /** 便于测试注入。默认从容器解析。 */
    toolManager?: IToolManager;
    terminalPublisher?: AcpTerminalPublisher;
    notifier?: Pick<BackgroundTaskNotifier, 'notifyCompletion'>;
}
/**
 * 执行取消。
 *
 * 返回四态而不是 boolean：现有 `killBackgroundTask` 只返回 boolean，"任务不存在"与
 * "kill 失败"都是 `false`，但对客户端是两种完全不同的处理——前者该把卡片收敛掉，
 * 后者必须提示"取消失败，进程可能还在跑"。这四态也都走成功响应，不用 JSON-RPC error
 * 表达业务结果（与 MCP 把工具层错误放在 result 里的分工一致）。
 */
export declare function cancelBackgroundTask(deps: CancelBackgroundTaskDeps): Promise<CancelBackgroundTaskResult>;
/** Shared user-cancellation path; the registry remains the execution/state owner. */
export declare function cancelRegisteredBackgroundTask(deps: Omit<CancelBackgroundTaskDeps, 'terminalId'>, task: BackgroundTask): Promise<CancelBackgroundTaskOutcome>;
