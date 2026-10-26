/**
 * 任务板**事件本体**与它改动的字段集合：node 域、落盘记录、文案层与 web-ui 共用这一份。
 *
 * 零 import：目录记录（agent-home-directory）与 web-ui 都会引用它，
 * 而这两条链路都受 agent-home-web-ui-shared-imports.spec.ts 约束（不许牵出 node 侧重模块）。
 */
/** `updated` 事件改了哪几项（与 i18n 的 field.* 一一对应）。 */
export type AgentHomeChannelTaskChange = 'subject' | 'detail' | 'assignee' | 'refs' | 'owner';
export declare function isAgentHomeChannelTaskChange(value: unknown): value is AgentHomeChannelTaskChange;
/**
 * 结构化事件（落盘进频道 jsonl 的 `taskPayload`，界面按当前语言渲染）。
 * 单任务事件带 `subject`，批量事件带 `taskIds` / `subjects`。
 */
export interface AgentHomeChannelTaskEventPayload {
    type: string;
    taskId?: string;
    taskIds?: string[];
    subject?: string;
    subjects?: string[];
    ownerId?: string;
    assigneeId?: string;
    actorId?: string;
    changes?: readonly AgentHomeChannelTaskChange[];
    /** completed / batch_done 事件对应的主会话，回执按地址投回。 */
    originSessionId?: string;
}
