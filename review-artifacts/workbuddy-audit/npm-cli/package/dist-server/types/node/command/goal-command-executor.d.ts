import { GoalService } from '@genie/cbc-goal';
import { AcpBroadcastService, GoalRecapPayload } from '../acp/acp-protocol';
import { NavigationManager } from '../navigation';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
/**
 * `/goal` 斜杠命令。
 *
 * 仅做参数派发：
 *   /goal               → 打开 recap 面板（TUI 走 NavigationManager；Web UI ACP
 *                          走 AcpBroadcastService.broadcastGoalRecap）
 *   /goal clear         → goalService.clear
 *   /goal pause         → 已有 goal 则 pause；否则 set("pause")（旧斜杠语义）
 *   /goal resume        → 已有 goal 则 resume；否则 set("resume")
 *   /goal <condition>   → goalService.set
 *
 * 业务逻辑（hook 注册、文案、metric）全部在 GoalService 里。Executor 留得越薄
 * 越容易单测——单测里 mock GoalService 即可断言派发是否正确。
 *
 * 双通道触发理由：TUI 的 NavigationManager 路径是本地 React Ink 路由，根本
 * 不会过 ACP，Web UI 看不见；反过来 Web UI 的 ACP 客户端也不参与 TUI 路由。
 * 两条路径同时触发，对端没连接时 broadcast fan-out 自动空集合跳过，对端连接
 * 时各自打开自己 UI 框架下的面板。
 *
 * Headless / SDK 场景下 NavigationManager 与 AcpBroadcastService 都不可用
 * （`@Optional`），降级走 goalService.show 的纯文本输出，保留兼容。
 */
export declare class GoalCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly goalService: GoalService;
    protected readonly navigationManager?: NavigationManager;
    protected readonly acpBroadcastService?: AcpBroadcastService;
    execute(ctx: CommandExecuteContext): Promise<void>;
    /** WorkBuddy/unopted ACP keeps the historical `/goal <condition>` parser. */
    protected supportsPauseResumeCommands(session: CommandExecuteContext['session']): boolean;
    /**
     * 同时给 TUI（NavigationManager）和 Web UI（ACP broadcast）发起 recap 面板。
     *
     * - TUI 路径：本地路由切换，不依赖 session 数据，直接 navigate 即可，UI 自己从
     *   GoalService 拉取 active/latest。
     * - Web UI 路径：ACP 客户端拿不到 GoalService，需要服务端把 recap snapshot
     *   组装好通过 _meta 推过去。两个路径数据源同一个，行为对齐。
     *
     * @returns 是否至少一条通道成功触发（用于 headless 降级判断）。
     */
    protected openRecapPanels(session: CommandExecuteContext['session']): Promise<boolean>;
    /** 把 GoalService 的 active / latest 投影成 ACP recap payload。 */
    protected buildRecapPayload(session: CommandExecuteContext['session']): GoalRecapPayload;
}
