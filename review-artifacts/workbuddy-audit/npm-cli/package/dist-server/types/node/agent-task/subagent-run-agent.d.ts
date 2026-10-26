/**
 * 本轮 run 用哪个 agent（模式）跑（issue #127405 · P1/P2）。
 *
 * 规则：**AgentTask 子会话一律跟随 leader 的站立模式**（工具面 / Code Mode 一致）——
 * Agent tool、团队、workflow、多任务派出的子代理（含 Explore）都没有例外。
 * 用户口径（2026-09-22）：会话切到 ptc，子代理就得跑 ptc；「Explore 保留自身工具面」那条例外已作废
 * （issue 验收矩阵里的对应行随之作废）。
 *
 * fork 组合与真正的 agent 解析仍在调用点做（模式名是 fork 时走父组合继承）。
 */
export declare function resolveSubagentRunAgentName(input: {
    subagentType: string;
    mainAgentName?: string;
    mainSession?: {
        meta?: Record<string, unknown>;
    };
}): {
    agentName: string;
    fromLeaderMode: boolean;
};
