export interface ChannelWakeGuard {
    /** 去重桶：有 room turn 时 = 轮次身份（startedAt#round）；没有时 = 时间窗序号。 */
    bucket: string;
    /** 该桶里已经被自动叫过的人。 */
    wokenIds: string[];
    /** 窗口内的自动唤醒时间戳（超过上限就抑制）。 */
    autoWakes: number[];
}
/** 护栏文件：channels/<id>.wake.json。文件名 = channel.id，不是显示名。 */
export declare function agentHomeChannelWakeGuardPath(homeDir: string, channelId: string): string;
/** 读护栏（容错：缺失 / 坏 JSON / 字段类型不对一律当空，绝不因为护栏挡住唤醒）。 */
export declare function readChannelWakeGuard(homeDir: string, channelId: string): ChannelWakeGuard;
/**
 * 预约这一棒能叫谁。
 * - `bucket` 变了（新一轮 / 新窗口）→ 已叫名单清空；
 * - 窗口内自动唤醒次数达上限 → 一个都不叫（`suppressed: 'rate'`）；
 * - 同一桶里已经叫过的人 → 去重（进 `deduped`）。
 */
export declare function reserveAutoWakes(input: {
    homeDir: string;
    channelId: string;
    bucket: string;
    now: number;
    targets: readonly string[];
}): Promise<{
    allowed: string[];
    deduped: string[];
    suppressed: 'rate' | undefined;
    stampedAt?: number;
}>;
/**
 * 释放一次**没能送达**的预约：把这些人从 wokenIds 里删掉，让本 turn 内后续的
 * 重试还能叫到他们；这一笔限速计数也一并撤回。
 *
 * 场景（实测：队列卡在第二位成员）：自动链预约成功（先去重名单里占了名额），
 * 投递时才发现对方进程已死 → wake_skipped。名额不释放的话，同 turn 内任何重试
 * 都被去重挡住，整条接力链永久停在死人身上（护栏不该替"人死了"背锅）。
 *
 * 限速也要撤：预算是"这个频道每窗口最多自动叫几次"，本意是防 @ 风暴烧钱；
 * 一次**没送出去**的投递既没烧 token 也没起进程，却会吃掉 1/3 的窗口预算
 * （默认 3 次 / 3 分钟）——一条死人链三次就能把整个频道的自动唤醒堵死，连活人
 * 都叫不动。桶变了（新一轮）说明名单已自然复位，直接不动。
 */
export declare function releaseAutoWakes(input: {
    homeDir: string;
    channelId: string;
    bucket: string;
    targets: readonly string[];
    /** 这次预约记下的限速时间戳（reserveAutoWakes 返回的 `stampedAt`）；传了就撤回。 */
    stampedAt?: number;
}): Promise<void>;
/**
 * 去重桶键：
 * - 有进行中的轮次 → 用轮次身份（turn.startedAt + 轮次号）：**同一次轮次里不重复
 *   叫同一个人**。只用轮次号不够——每次用户发言都开一个 round=0 的新 turn，旧 turn
 *   里叫过的人在新 turn 里会被当成"这轮已经叫过"整条链去重掉（实测：第二次用户
 *   发言后只有第一位被叫，队列再也不往下走）。
 * - 没有轮次（成员插话）→ 用时间窗序号（窗口内同样不重复叫人）。
 */
export declare function channelWakeBucket(channelId: string, turn: {
    startedAt: number;
    round: number;
} | undefined, now: number): string;
