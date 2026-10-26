/**
 * 站立模式的纯数据读取层，不导入 agent/multitask 的运行时模块。
 * 子任务、workflow 等启动路径在组合根初始化期间也可以安全读取。
 *
 * session.meta 中主 agent 选择的持久键（设计 v0.6 §3.1 唯一权威源）。
 * `meta.agentName` 是子代理身份，`session.agentName` 是临时运行名；站立模式只读本键。
 */
export declare const MAIN_AGENT_META_KEY = "codebuddy.ai/mainAgent";
/** 会话持久的站立主 agent（只读 meta 键，不读 telemetry `session.agentName`）。 */
export declare function standingMainAgentName(session?: {
    meta?: Record<string, unknown>;
}): string | undefined;
