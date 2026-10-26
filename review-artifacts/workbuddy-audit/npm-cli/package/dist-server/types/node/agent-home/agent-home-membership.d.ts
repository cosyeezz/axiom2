/**
 * 组队/房间/频道共用的加入规则。无 I/O，web-ui 可直接 import。
 *
 * 一句话定位：**主 Agent 是委托侧（用户当前的工作现场），房间是执行侧**，
 * 所以主 Agent 不进房间也不进频道——它不是常驻执行者：
 * - 它随窗口/进程生灭，房间编排要的"稳定身份 + 能判活 + 常驻上下文"三条都不满足；
 * - 它占着轮次的一棒却判不了死活（看门狗只能"判不了就当活着"），唤醒投递又会落到
 *   一口无主邮箱（谁先醒谁读），10 个窗口就等于 10 个"房间里的你"；
 * - 它的上下文是用户私有的工作现场，房间信息不该注入进去。
 * 委托只允许单向：主 Agent → 房间（建群 / 派单 / 读板 / 说一句），
 * **不存在 房间 → 主 Agent**（不唤醒、不注入、不占席位）。
 * 上游同理：成员清一色是 agent，用户是"发言人"而不是成员
 * （resolveResponders 扫的是 speaker.kind === user）。
 *
 * 空 id / 主 Agent / 极简都不能进。
 *
 * **分身入群**（主 Agent 档案的 joinTeams，缺省 = 开）：开着时主 Agent 以「分身」身份
 * 列进房间/频道的成员表——同事能在名册里看到它、@ 它；但上面三条仍然成立，所以它
 * **只占名册不占席位**：不进叫醒池、不排进轮次、不起 job。同事 @ 它时走主邮箱
 * （见 agent-home-channel-wake 的 notifyTwinMention），它在频道里说的话仍落成用户发言。
 * 资格判定（能不能被加进来）用 teamBlockedDefaultId；叫醒/轮次/job 一律仍按真实
 * defaultAgentId 排除。关掉开关后读盘清洗会把它从所有频道剔掉。
 */
export interface TwinSwitchSource {
    defaultAgentId?: string | null;
    agents?: readonly {
        id: string;
        joinTeams?: boolean;
    }[];
}
/** 分身（主 Agent）能否被加进房间/频道。缺省 = 能（开关默认打开）。 */
export declare function twinJoinsTeams(directory: TwinSwitchSource | undefined): boolean;
/**
 * 成员资格判定要拦的主 Agent id：分身开关开着 → undefined（不拦）。
 * 只给「能不能进成员表」用；叫醒池 / 轮次 / job 仍传真实 defaultAgentId。
 */
export declare function teamBlockedDefaultId(directory: TwinSwitchSource | undefined): string | undefined;
export type RoomMessageCallStyle = 'none' | 'direct' | 'repl';
export declare function roomMessageCallStyle(engine?: string): RoomMessageCallStyle;
export declare function canJoinAgentHomeTeam(agentId: string, defaultAgentId?: string | null, engine?: string): boolean;
/** 进不了房间/频道的原因。主 Agent 与极简同一条禁令，文案分开。 */
export type AgentHomeTeamJoinBlock = 'default' | 'minimal';
export declare function agentHomeTeamJoinBlock(agentId: string, defaultAgentId?: string | null, engine?: string): AgentHomeTeamJoinBlock | undefined;
/** 主 Agent + 极简。sanitize / 加人计划共用。 */
export declare function blockedTeamAgentIds(agents: readonly {
    id: string;
    engine?: string;
}[], defaultAgentId?: string | null): Set<string>;
export declare function canJoinAgentHomeRoom(agentId: string, defaultAgentId?: string | null, engine?: string): boolean;
/**
 * 频道成员资格：**与组队同一条**（主 Agent 是委托侧的工作现场，不进房间；
 * 极简在房间里说不了话也不进）。留这个函数名只为在调用点表达"这是频道面的资格判定"，
 * 策略只有 canJoinAgentHomeTeam 一份。
 */
export declare function canJoinAgentHomeChannel(agentId: string, defaultAgentId?: string | null, engine?: string): boolean;
