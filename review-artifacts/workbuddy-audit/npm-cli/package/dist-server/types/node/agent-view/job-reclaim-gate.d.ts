export declare class JobReclaimGate {
    private active;
    private revision;
    private draining;
    private committed;
    enter(): () => void;
    prepare(): number | undefined;
    /**
     * prepare() 返回 undefined 时卡在哪一态。
     *
     * 只笼统打一个 gate-busy 时，"有请求在跑"和"已 commit 但进程没退成功"在日志里
     * 长得一模一样，而后者是永久不可恢复的——committed 之后 prepare() 再也不会成功。
     * 拒绝日志带上细分原因，卡死才能一眼区分。
     */
    describeBusy(): 'gate-committed' | 'gate-active' | 'gate-draining' | 'gate-free';
    isPrepared(revision: number): boolean;
    commit(revision: number): boolean;
    cancel(revision: number): void;
}
export declare const jobReclaimGate: JobReclaimGate;
export declare function enterJobActivity(): () => void;
