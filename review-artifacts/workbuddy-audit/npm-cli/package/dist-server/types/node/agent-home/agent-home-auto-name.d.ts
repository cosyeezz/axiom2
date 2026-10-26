/**
 * 占位名自动转正：用户新建智能体时没起名，档案先挂「新智能体」并标 `nameSource: 'auto'`；
 * 它的主对话第一次生成 AI 标题后，把标题换成名字，同时清掉标记——之后这个名字和用户
 * 亲手起的一样，不再被任何标题覆盖。
 *
 * 标题和认领谁先到不确定（前端先派发 Run、再建档、再认领），所以有两个入口，都落到
 * {@link applyAgentHomeAutoName}：
 * - 标题先到：job 进程先把标题写进 job 状态，网关认领时读到再换名；
 * - 认领先到：job 进程拿到标题后直接调 {@link autoNameAgentHomeAgentForJob}。
 * 两边都在目录锁里判 `nameSource`，换过一次就不会再换。
 *
 * 与 directory 分模块是为避开循环依赖（同 agent-home-session-owner）。
 */
import { type AgentHomeDirectoryFile } from './agent-home-directory';
export declare function normalizeAgentHomeAutoName(title: string | undefined): string | undefined;
/** 原地改 directory；返回是否换了名。调用方负责持锁与落盘。 */
export declare function applyAgentHomeAutoName(directory: AgentHomeDirectoryFile, jobId: string, title: string | undefined): boolean;
/**
 * job 进程侧入口。先无锁读一遍：绝大多数 Run 没有待转正的主人，不该为它们碰目录锁
 * （Agent Home 关闭时连锁目录都不能建出来）。
 */
export declare function autoNameAgentHomeAgentForJob(homeDir: string, jobId: string, title: string): Promise<boolean>;
