/**
 * 同事（Agent Home colleague job）的记忆落点与共享层。
 *
 * ## 为什么分区
 *
 * 对齐上游 sand-memory 的 shard per assistant：上游把记忆按 agent 分目录，注释里
 * 写明了意图——"one shard folder per assistant so every file has a single writer"。
 *
 * 我们原来的记忆目录只按 cwd 分（`projects/{projectId}/memory/`）：同一个仓库下的
 * 主 Agent、同事、子代理共用同一个 `MEMORY.md`。而提取是"对话结束 fire-and-forget
 * 起一个 run 去写文件"，几个同事同时写就是后写覆盖先写，也分不清是谁学到的。
 *
 * ## 写私有、读共享
 *
 * 对齐上游 own > project > user 的三层优先级：
 * - 写：`projects/{projectId}/memory/agents/{agentId}/`（私有，单写者）
 * - 读：自己的分区 + 项目（cwd）记忆 + 全局记忆（后两者只读，靠提示里的路径去
 *   Read / Grep；共享层保持单写者，不因为"读得到"就变成谁都能写）
 *
 * ## 门闸
 *
 * `isAgentHomeExclusiveToolSurface`（表面 ∧ 非子会话，含 WorkBuddy 宿主硬排除）
 * 之上再加一条：**有 jobId 且该 job 能在 agent-home 目录里解析成同事**——普通 TUI
 * 里的子代理也有 jobId，靠这条排除。任一不成立返回 undefined = 调用方走原路径。
 */
export interface ColleagueMemoryScope {
    /** 私有分区：写这里。 */
    memoryDir: string;
    /** 项目（cwd）记忆：同事可读不可写。 */
    projectDir: string;
    /** 全局记忆（跨项目的本机共享层）：同事可读不可写。 */
    globalDir: string;
}
/**
 * 解析当前会话是不是"该分区的同事"。不是就返回 undefined。
 * 纯解析：不建目录（要写提示前先调 ensureColleagueMemoryDir）。
 */
export declare function resolveColleagueMemoryScope(input: {
    session?: unknown;
    agent?: unknown;
}): Promise<ColleagueMemoryScope | undefined>;
/**
 * 记忆提示写着 "This directory already exists — write to it directly"，所以注入提示
 * 前把私有分区建出来（幂等）。建不出来不拦：Write 工具自己会补父目录。
 */
export declare function ensureColleagueMemoryDir(scope: ColleagueMemoryScope): void;
/**
 * 同事记忆的提示补充（挂到 buildMemoryPrompt 的 extraGuidelines）。
 *
 * 只对同事生效：主 Agent / TUI / WorkBuddy 的提示文本一个字节都不改。
 */
export declare function colleagueMemoryGuidelines(scope: ColleagueMemoryScope): string[];
