/**
 * 进程型 teammate 的 argv **唯一来源**（detached / tmux 两个 backend 共用）。
 *
 * 为什么要抽出来：两个 backend 原本各自拼一遍同样的 flag 序列，PR 评审指出这种「靠两份实现 +
 * 一组「同款」用例保证一致」的结构会在下次新增 flag 时漏改一边。现在语义（顺序、条件、权限档回填）
 * 只在这里定义；两侧只在**转义层**分叉（tmux 逐 token 过 shellEscape 拼进 shell 命令，detached
 * 直接用数组走 spawn）。
 *
 * 权限档回填只在这条链路做：进程型 teammate 没有 options 继承通道；in-process 路径的档位有
 * 自己的优先级链（AgentTask.configurePermissionMode），别在 spawn 层改写它。
 */
import type { TeammateSpawnConfig } from './teammate-backend-protocol';
export interface TeammateArgvOptions {
    /**
     * tmux 通道：没有 leaderEndpoint 时补 `-y`（既有行为）。
     * detached 不用它 —— 那条通道的自动批准由 `skipAutoApprove` 与 daemon 侧处理。
     */
    autoApproveWhenNoLeaderEndpoint?: boolean;
}
/**
 * 拼 teammate 子进程的 argv（不含入口与 env 前缀）。
 *
 * 顺序即契约：身份 → 主模式 → 父会话 → 展示/连接 → 模型 → 权限档 → 轮数上限；
 * 每个 flag 都只在有值时才出现（不发明空值）。
 */
/**
 * teammate argv 里**不带值**的双横线裸 flag —— argv 的唯一来源在此，所以清单也由此导出，
 * 由 `teammate-runner` 的值位感知解析反向 import（评审 #128343：消除人工同步点）。
 *
 * 单横线 flag（`-y`）不在此列：runner 的解析按 `--` 前缀分派，单横线走另一分支。
 * 新增裸 flag 只需加到这里；有一条 spec 断言「buildTeammateArgv 产出的双横线 token 里，
 * 不带值的那些必须全部落在本清单内」，漏加会直接红。
 */
export declare const TEAMMATE_BARE_FLAGS: readonly ["--serve", "--teammate-mode", "--private-data-sticky"];
export declare function buildTeammateArgv(config: TeammateSpawnConfig, options?: TeammateArgvOptions): string[];
