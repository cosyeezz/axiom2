/**
 * 任务板的**分组色调 + 组内顺序**：node 域与 web-ui 共用这一份。
 *
 * 两侧各写一份曾经漂过：done 组一边按 doneAt 排、一边按 updatedAt 排，而拖拽重排的
 * 目标位次是前端按自己那份算、服务端按自己那份算的（两份必须逐字一致才成立）。
 *
 * 零 import：它会被 web-ui 直接引用（见 agent-home-web-ui-shared-imports.spec.ts），
 * 别在这里引 node 侧模块。
 */
/** 排序只关心这几个字段；node 的 AgentHomeChannelTask 与 web-ui 的 DTO 都结构化兼容。 */
export interface ChannelTaskOrderFields {
    status: 'open' | 'claimed' | 'done';
    stalled?: boolean;
    sortIndex?: number;
    updatedAt: number;
    doneAt?: number;
}
export type ChannelTaskTone = 'stalled' | 'claimed' | 'open' | 'done';
export declare function channelTaskTone(task: ChannelTaskOrderFields): ChannelTaskTone;
/**
 * 组内顺序：手工顺序（`sortIndex` 升序）在前，没设过的按最近活动倒序跟在后面
 * （已完成的看完成时间，其余看更新时间）。
 * 新任务建的时候会拿到一个比全板都小的 `sortIndex`，于是落在自己那组的顶上。
 */
export declare function compareChannelTasks(a: ChannelTaskOrderFields, b: ChannelTaskOrderFields): number;
