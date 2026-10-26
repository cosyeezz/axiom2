import { type Session } from '../../vendor/cbc-core/node/index.js';
import { GoalService } from '@genie/cbc-goal';
import { type GoalRecapPayload } from './acp-protocol';
export interface GoalControlRequest {
    sessionId?: string;
    action?: string;
    condition?: string;
    /**
     * 宿主持久态快照（core 的 `ConversationInfo.goal`，与 sessionSnapshot 的 activeGoal 同形）。
     *
     * - **有值**：以宿主为权威，`restoreFromHost` 只重建 CLI 执行镜像（卸/挂 hook），
     *   不用 history 反推、不覆盖宿主持久态；
     * - **显式 `null`**：宿主说"当前没有目标" → 清掉本地执行镜像；
     * - **字段缺省**：旧宿主 / 只读客户端 → 保持原 CLI/WebUI 语义（history 兜底恢复）。
     */
    activeGoal?: GoalControlSnapshot | null;
}
/**
 * 控制动作的**结构化结果**：宿主靠它决定提示与重试，而不是自己猜。
 *
 * - \`applied\` 是"这次动作实际做了什么"，成功语义按值区分：
 *   - \`paused\` / \`resumed\` / \`cleared\` / \`set\` / \`snapshot\`：动作生效；
 *   - \`noop-no-run\`：状态已更新，但当前进程里没有可打断/可续跑的回合
 *     （宿主应提示"已暂停，本轮已结束"之类，而不是显示成生效在跑）；
 *   - \`noop-no-goal\`：没有目标可操作（宿主应把条清掉或提示）；
 *   - \`not-ready\`：会话还没 attach 好，宿主可安全重试。
 * - \`runInFlight\` 让宿主知道"暂停有没有真的停住东西"。
 */
export type GoalControlApplied = 'paused' | 'resumed' | 'cleared' | 'set' | 'snapshot' | 'noop-no-run' | 'noop-no-goal' | 'not-ready';
/**
 * 控制动作里回给宿主的目标快照：与 \`sessionSnapshot\` 帧的 \`activeGoal\` 同形状
 * （见 AcpBroadcastService.broadcastSessionSnapshot），宿主两个通道共用一份解析。
 */
export interface GoalControlSnapshot {
    condition: string;
    createdAt: number;
    paused?: boolean;
    pausedAt?: number;
}
export interface GoalControlResult {
    /**
     * 无参 /goal 的状态 / recap 数据（当前只有 snapshot 动作回；其余动作缺省）。
     *
     * 与 Web UI 的 goalRecap 帧同源同字段：active（条件 / 暂停态）或 latest（ok / reason /
     * 条件 / durationMs / turnCount / tokenDelta）。宿主据此渲染状态面板；两者都没有时为空对象。
     */
    recap?: GoalRecapPayload;
    ok: true;
    action: string;
    /** 同条件重复 set 走 resume，此时 applied='resumed'（不清计时、不换 hook）。 */
    applied: GoalControlApplied;
    hasGoal: boolean;
    /** 动作前后该会话是否有在跑的回合（宿主用它判定"秒停"是否真的发生）。 */
    runInFlight: boolean;
    /**
     * 动作**执行后**的权威快照：null = 当前没有目标。宿主不必等广播帧就能立刻更新状态条
     * （帧丢失 / 订阅切换时也不会停在旧态）。
     *
     * not-ready 时**缺省**（此刻还不知道目标状态）：宿主必须静默重试，不能按「无目标」清条。
     */
    activeGoal?: GoalControlSnapshot | null;
}
export declare function buildGoalRecapPayload(goalService: GoalService, session: Session): GoalRecapPayload;
/**
 * 执行目标条动作。
 *
 * @param request 宿主下发的动作载荷（action 必填，set 需要 condition）
 * @param getSession 由 AcpAgent 提供的会话解析器（与其它 ext method 同一口径）
 */
export declare function handleGoalControl(request: GoalControlRequest, getSession: (sessionId: string) => Promise<Session | undefined>, 
/** 调用方连接 id：校验目标会话是否属于本连接（与其它 ACP ext method 同一道边界）。 */
connectionId?: string): Promise<GoalControlResult>;
