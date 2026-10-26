export declare function resolveMessageSpeakerLabel(input: {
    session?: {
        id?: string;
        storeId?: string;
        meta?: Record<string, unknown>;
    } | undefined;
    runAgentName?: string;
}): string | undefined;
/**
 * 子会话的**展示名**（给人看）：团队成员用成员名，其余子代理用自身预设名（`meta.agentName`）；
 * 主会话 / 无会话 / 无身份线索返回 undefined。**只用于展示与遥测标签，不要拿它查表。**
 */
export declare function resolveSubAgentDisplayName(session: {
    id?: string;
    storeId?: string;
    meta?: Record<string, unknown>;
} | undefined): string | undefined;
/**
 * 子会话的**查表键**（REPL 沙箱白名单 / overlay 缓存用）：只认「预设名」这一种语义。
 *
 * 与展示名刻意分开（评审）：团队成员会把自己的成员名写进 `meta.agentName`（teammate-runner），
 * 于是 `meta.agentName` 同时承载「预设名」与「成员名」两种含义 —— 拿成员名去查 agent 配置查不到，
 * 只能落到默认 agent 的兜底（既不是成员自己的白名单、也不是「不过滤」）。取不到可信的预设名时
 * 返回 undefined = 不额外收窄（与改动前一致），不去猜。
 */
export declare function resolveSubAgentAgentKey(session: {
    id?: string;
    storeId?: string;
    meta?: Record<string, unknown>;
} | undefined): string | undefined;
/** 展示名的**派发侧镜像**：子会话还没建时拿不到 `meta.teamContext`，但这对值就是稍后写进 session 的同一对。 */
export declare function resolveSubAgentDisplayNameFromParts(input: {
    memberName?: string;
    presetName?: string;
}): string | undefined;
/**
 * 查表键的**派发侧镜像**（AgentManager.sandboxScopedAgentView 传身份用）：
 * 预设名与成员名**同值**（团队成员把自己的名字写进 meta.agentName）时判为「没有可信预设名」→ undefined，
 * 与运行期 `resolveSubAgentAgentKey` 同源 —— 否则派发侧按成员名收窄、执行侧判不到，两边分叉。
 */
export declare function resolveSubAgentAgentKeyFromParts(input: {
    memberName?: string;
    presetName?: string;
}): string | undefined;
//# sourceMappingURL=speaker-label.d.ts.map