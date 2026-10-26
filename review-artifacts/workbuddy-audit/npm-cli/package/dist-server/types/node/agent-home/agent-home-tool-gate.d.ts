/**
 * Agent Home 自治工具（CreateColleague / CreateChannel / ChannelTasks）专属闸门。
 *
 * 在 `isAgentHomeSurface`（宿主 / 形态否决之外、且**入口是 Web UI 或同事 job** 的会话；
 * 无 hint 的进程级消费者按同事 job / --serve 宿主判）之上，再排除三类「不是主对话」的会话，
 * 避免子代理、团队成员、内部生成器 agent 拿到建人 / 建频道 / 改任务板的能力：
 *
 * - 子代理：`SessionUtils.isSubAgent`（storeId 与 id 不同）或 `meta.parentSessionId`
 * - 团队成员：`meta.isTeamMember` / `meta.teamContext`。**不含 `meta.isTeamLead`**：lead 是
 *   spawn 过子 agent 的那个会话本身，仍是该同事自己的主对话（storeId 等于 id、没有父会话），
 *   没有"影子会话冒名"的问题。把它当子会话会让 spawn 一次就永久失声、不能改任务板，而且
 *   该标记会随会话落盘，重启后依旧（#150668）。
 * - 生成器：`INTERNAL_GENERATOR_AGENTS`（compact / summary 等旁路 LLM 调用）
 *
 * 与 `agent-home-membership.ts` 不同，本模块允许依赖会话与 agent 协议——
 * 它只服务 Node 侧工具，web-ui 不要 import。
 */
import { type AgentHomeSettingsSource } from './agent-home-settings';
/** 子代理 / 团队成员 / 内部生成器：看得见主对话之外的工具面，自治工具必须挡住。 */
export declare function isAgentHomeSubSession(args?: unknown): boolean;
/** 自治工具的唯一表面判据：Agent Home 表面 ∧ 非子会话。 */
export declare function isAgentHomeExclusiveToolSurface(args?: unknown): boolean;
/** 工具 execute：不在自治表面上时的拒绝文案。在表面上返回 undefined。 */
export declare function agentHomeExclusiveToolUnavailableMessage(args: unknown): string | undefined;
/**
 * 自治工具的完整开关：表面 ∧ 非子会话 ∧ Web UI 设置里的开关。
 * 工具 isEnabled 直接 await 本函数；execute 里 `!enabled` 时用下面的文案硬拒。
 */
export declare function isAgentHomeOrchestrationToolEnabled(args: unknown, settingsManager?: AgentHomeSettingsSource): Promise<boolean>;
/**
 * 频道任务板的**读**闸门：表面 ∧ 设置开。刻意不含「非子会话」——那条只约束写操作。
 */
export declare function isAgentHomeBoardReadEnabled(args: unknown, settingsManager?: AgentHomeSettingsSource): Promise<boolean>;
/**
 * 频道任务板的**写**操作是否允许：读板与写板分权。
 *
 * 为什么分开：任务板的写操作（create / claim / complete / release / update / delete /
 * dispatch / escalate）要可追责 —— 一个任务一个 owner。fork / subagent / Agent Teams 会话
 * 会与同事的主对话共享同一个 Agent Home 身份（见 sessionAssignments），若允许它们改板，
 * 会出现「影子会话认领了任务、真人不知道」这种归属混乱。读板（list）没有这个问题，而且
 * 让派生会话看得见板能避免重复劳动，所以读按身份放行、写留在主对话。
 *
 * 判据里**不含** `isAgentHomeSurface`：调用方先过 `agentHomeRoomToolRefusal` /
 * `isAgentHomeOrchestrationToolEnabled`（表面 + 设置），这里只回答「派生会话能不能写」。
 */
export declare function isAgentHomeBoardWriteAllowed(args?: unknown): boolean;
/**
 * 以**同事身份**在频道发言是否允许。
 *
 * 发言有对外副作用（进频道历史、唤醒别人），所以和写任务板同级按归属约束：只能发生在
 * 该同事自己的主对话里。fork / subagent / Agent Teams 会话经 sessionAssignments 共享同一
 * 身份，若放开，等于让一次性子代理冒充同事对房间讲话。
 *
 * 默认 Agent 不在此列（调用方判断）：它不占席位、是「像用户一样说一句」，属用户驱动的动作，
 * 从 fork 出来的会话里也应当能用。
 */
export declare function isAgentHomeColleagueSpeechAllowed(args?: unknown): boolean;
/** 同事身份发言被拒时的文案：指明回主对话，别让模型反复重试。 */
export declare function agentHomeColleagueSpeechRefusalMessage(speakerName: string): string;
/**
 * 以**同事身份**私信（1:1）是否允许：判据与发言同一份（`!isAgentHomeSubSession`）。
 *
 * 私信同样是**对外动作**：它写进对方的会话，收件人还可以是主 Agent（= 用户主对话邮箱）。
 * 派生会话共享同事身份，若放开等于让一次性子代理借同事的名字和身份往别人会话里塞话。
 * 读通讯录（action=list）不在此列 —— 与任务板同一条读/写分权。
 */
export declare function isAgentHomeColleagueDirectMessageAllowed(args?: unknown): boolean;
/** 同事身份私信被拒时的文案：与发言同一条口径，指明回主对话。 */
export declare function agentHomeColleagueDirectMessageRefusalMessage(senderName: string): string;
/** 读板放行、写板被拒时的文案：明确告诉模型改用哪条路，避免它反复重试同一个动作。 */
export declare function agentHomeBoardWriteRefusalMessage(action: string): string;
/** 表面成立、只是被设置/总闸关掉时的拒绝文案（能力中立：建人建频道、发言、私信都用它）。 */
export declare function agentHomeOrchestrationDisabledMessage(): string;
/**
 * 房间类工具（SpeakInChannel / MessageColleague）的统一闸门：拒绝时给文案，放行给 undefined。
 * 顺序固定：先产品级不可用（不在表面 / 子会话），再设置级关掉。isEnabled 与 execute 共用，
 * 免得两个地方的判据与文案各写一份。
 */
export declare function agentHomeRoomToolRefusal(args: unknown, settingsManager: AgentHomeSettingsSource | undefined, product: 'channel' | 'room'): Promise<string | undefined>;
/**
 * 自治工具 `shouldShowInToolSearch` 的统一口径；房间类工具用 `hasLocal` 追加自己的
 * "有频道 / 有房间"前提（它的 isEnabled 已经改写成了异步，同步回调读不到设置）。
 *
 * 为什么是"近似"：deferred 可见性回调只接受同步返回，且**拿不到 session**
 * （`ToolManager.indexDeferredTool` 存的是不带参数的 bound 函数，
 * `buildDeferredToolEnabledCheck` 也是拿 `runContext: undefined` 调 isEnabled）。
 * 于是只能退回进程级信号：功能总闸 + 有没有 jobId + 宿主是不是 web-ui。
 *
 * 实测现状：这几个工具**不在** `product.tools` 的 `deferLoading` 列表里 →
 * `indexDeferredToolsFromProductConfig` 不会索引它们 → 本回调当前不会被调用。
 * 保留它是为了将来若被标成 deferred 时有正确口径：真正的门槛始终是带 session 的
 * `isEnabled` / `execute`（`isAgentHomeExclusiveToolSurface`），这里给宽了也只是
 * 多一条提示，不会多一份能力。
 *
 * `hasLocal`（如 hasChannelIdentity / hasReachableTarget）走的是**宽松口径**
 * （`resolveMeAsAgent` 缺省 `fallbackToDefault`，未认领的 job 也解析成默认 Agent）——
 * 与 isEnabled 同源：可见性放宽、身份不并，别把它改成 strict，否则未认领 job 的工具会
 * 整体消失。动作口径（strict）只在各工具 execute 里生效（#125667 评审）。
 *
 * 注意别把它当成"Cli 会话可见"的开关：普通 TUI（host=cli、无 job）在这里是 false，
 * 而它在 REPL 沙箱里同样调不动——两边一致。
 */
export declare function agentHomeToolSearchVisibility(hasLocal?: () => boolean): boolean;
