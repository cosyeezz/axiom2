/**
 * Agent Home 的开关解析。Web UI 用户可见的只有一个：`codebuddy.agentHome.orchestration`
 * （设置页「允许 Agent 自主组队」）。
 *
 * 两个判据分开，新增链路时按这个选，别再各处自己判：
 *
 * - **目录表面**（`surfaceEnabled`）：Web UI 能不能读写
 *   通讯录、频道和看板。默认开——Web UI 只有这一个工作台。只有 env 总闸、运维回滚键
 *   `agentHome.enabled=false` 会关，关掉时 Web 回落普通 Job 列表，不动已有数据。
 *   宿主闸不在这里：HTTP 面必须经 `resolveAgentHomeHttpState` / `isAgentHomeHttpEnabled`。
 * - **自治行为**（`orchestrationEnabled` / `isAgentHomeOrchestrationEnabled`）：自治工具
 *   （建人/建频道/任务板/发言/私信）、频道提醒注入、唤醒投递、轮次看门狗、运行时 arm。
 *   默认关，用户在设置页打开后才生效。这也是防"宿主判据漏网"的第二道锁。
 * - **例外：同事记忆的目录布局**只看"这是不是一个同事 job"（`agent-home-colleague-memory`）。
 *   开关不该改变数据落点——关一下就把同事的记忆目录指回共享目录，多同事又会互相覆盖。
 *
 * 优先级：env 总闸 > settings.enabled=false > 自治 env > settings.orchestration > 默认。
 * 读设置失败按"未配置"处理（总闸有 env 兜底）。
 */
import type { SettingsManager } from '../settings/settings-protocol';
export type AgentHomeTaskReceiptMode = 'all' | 'batch' | 'off';
export interface AgentHomeCodebuddySettings {
    agentHome?: {
        enabled?: boolean;
        orchestration?: boolean;
        /** 自动投递到主 Agent 的任务完成回执：逐条、仅整批或关闭。 */
        taskReceipts?: AgentHomeTaskReceiptMode;
    };
}
export type AgentHomeSettingsSource = Pick<SettingsManager, 'get'>;
/** 自治开关被环境变量锁定的方向；null = 没被锁，可由 settings 决定。 */
export type AgentHomeOrchestrationLock = 'on' | 'off' | null;
export interface AgentHomeCapabilityState {
    surfaceEnabled: boolean;
    orchestrationEnabled: boolean;
    /** settings 里是否显式写过布尔值（env 不算）。Web UI 迁移旧模式时靠它区分"没选过"。 */
    orchestrationConfigured: boolean;
    orchestrationLock: AgentHomeOrchestrationLock;
}
export declare function readAgentHomeCodebuddySettings(settingsManager?: AgentHomeSettingsSource): Promise<AgentHomeCodebuddySettings | undefined>;
export declare function resolveAgentHomeTaskReceiptMode(settingsManager?: AgentHomeSettingsSource): Promise<AgentHomeTaskReceiptMode>;
export declare function resolveAgentHomeCapabilityStateFrom(codebuddy: AgentHomeCodebuddySettings | undefined): AgentHomeCapabilityState;
/** 一次读盘得到目录与自治两个判据（SettingsManager.get 每次都做全 scope 合并）。 */
export declare function resolveAgentHomeCapabilityState(settingsManager?: AgentHomeSettingsSource): Promise<AgentHomeCapabilityState>;
/**
 * 目录表面是否可用。**不含宿主闸**——HTTP 面必须经 `isAgentHomeHttpEnabled`，
 * 别直接拿这个函数当"HTTP 能不能开"的判据。
 */
export declare function isAgentHomeSurfaceEnabled(settingsManager?: AgentHomeSettingsSource): Promise<boolean>;
/** 自治行为总闸：工具、频道提醒、唤醒、看门狗与运行时 arm 都走它。 */
export declare function isAgentHomeOrchestrationEnabled(settingsManager?: AgentHomeSettingsSource): Promise<boolean>;
