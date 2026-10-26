/**
 * 统一收件人解析：一个 ref（**id**）→ 投递目标。
 *
 * 对齐上游 `SendToAgent({ target_id })` 的语义：**目标是"某个 agent"，不是"某个房间成员"**，
 * 而且参数就是 id（上游文档原话："Use an id from your teammates list … — not a name"）。
 * 我们 1:1 只有两类落点：
 * - `colleague`：常驻同事 → 他的 job 收件箱（进程不在就拉起）；
 * - `main`：主 Agent = 委托侧的工作现场 → 主会话邮箱（idle 时注入）。
 * 频道（上游的 group 目标）走 SpeakInChannel，不在这里。
 *
 * 显示名不是地址：名字只用于正文里的 @ 点名（撞名时同名的人全部叫上，见 agent-home-mentions）。
 * 极简引擎的人不能当收件人，判据是「能不能进频道」（canJoinAgentHomeChannel：
 * 极简在房间里说不了话）——不是"它没有 job"：极简照样有 job，只是不参与房间编排。
 */
import { type AgentHomeDirectoryFile, type AgentHomeProfile } from './agent-home-directory';
export type HomeMessageTarget = {
    kind: 'colleague';
    id: string;
    name: string;
    /** 主对话（还没有 = 他还没开过口，投递即拉起）。 */
    jobId?: string;
} | {
    kind: 'main';
    id: string;
    name: string;
};
export type HomeMessageTargetLookup = {
    status: 'found';
    target: HomeMessageTarget;
} | {
    status: 'missing';
} | {
    status: 'ineligible';
    agent: AgentHomeProfile;
};
/** 全部可投递的人（主 Agent + 能进频道的同事），供"你能联系谁"的提示用。 */
export declare function listHomeMessageTargets(directory: AgentHomeDirectoryFile): HomeMessageTarget[];
export declare function resolveHomeMessageTarget(directory: AgentHomeDirectoryFile, ref: string): HomeMessageTargetLookup;
