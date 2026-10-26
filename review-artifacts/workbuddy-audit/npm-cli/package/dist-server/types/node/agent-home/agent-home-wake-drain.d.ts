/**
 * 叫醒 drain 互斥：busy 时后来的 kick 不能丢掉。
 * drain 可能 await respawn（秒级），期间新票必须再跑一轮。
 *
 * 补票只靠这个 do/while：body 跑完再判一次 pending，所以「跑这一轮时进来的 kick」
 * 一定会在同一把锁里补跑，不需要在 finally 之后再递归一次（那时 pending 已经是 false）。
 */
export declare function runExclusiveDrain(state: {
    draining: boolean;
    pending: boolean;
}, body: () => Promise<void>): Promise<void>;
