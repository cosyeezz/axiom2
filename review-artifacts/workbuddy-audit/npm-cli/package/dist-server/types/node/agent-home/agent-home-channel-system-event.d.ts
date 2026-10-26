/**
 * 频道系统事件行（如轮次收场）：结构化本体，UI 按当前语言渲染。
 *
 * 零 import：目录记录（agent-home-directory）与 web-ui 都会引用它，
 * 而这两条链路都受 agent-home-web-ui-shared-imports.spec.ts 约束（不许牵出 node 侧重模块）。
 */
/** 频道系统事件本体（落盘进 jsonl 的 `systemEvent`，界面按当前语言渲染）。 */
export interface AgentHomeChannelSystemEvent {
    type: 'room-turn-ended';
    reason: 'timeout' | 'gone' | 'silent' | 'relay-exhausted';
    /** 相关人名（"轮到谁没见回应" / "叫了谁都没接住"）。 */
    names?: string[];
}
/** 落盘时的兜底文案（UI 有 systemEvent 就按当前语言重渲染，text 只是旧记录/导出用）。 */
export declare function agentHomeChannelSystemEventText(event: AgentHomeChannelSystemEvent): string;
