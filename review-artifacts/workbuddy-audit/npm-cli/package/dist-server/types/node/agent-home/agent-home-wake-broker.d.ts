/**
 * 合法宿主（--serve / TUI / CLI）上的叫醒经纪：死人路径 inbox + wake 票，拉起后由 JobInboxConsumer 取信。
 * 活人只搬进 jobs/<id>/inbox，不再写 colleague-inbox。
 */
import { Application, ApplicationLifecycle } from '@celljs/core';
import { type IDaemonProcessManager } from '@genie/cbc-daemon';
import { type IJobStore } from '../agent-view/agent-view-protocol';
export declare class AgentHomeWakeBroker implements ApplicationLifecycle<Application> {
    private readonly store?;
    private readonly processManager?;
    private readonly settingsManager?;
    private readonly logger;
    private watch?;
    private disposeStarter?;
    private retryTimer?;
    private readonly gate;
    /** 看门狗自己的闸门：tick 可能重叠（fs watcher + 2s 定时器），重叠会重复叫人。 */
    private readonly sweepGate;
    onStart(): void;
    /** 真正起 watch + 2s tick（开关打开或进程启动时已开才会走到这）。 */
    private startRuntime;
    /**
     * 自治循环的入口闸：**每个 HOME 只允许一个实例跑**（见 agent-home-coordinator）。
     * 多开窗口/多端口是产品设计（共享同一个 Agent Home），但协调循环只能有一份——
     * 否则 N 个实例各跑一份 2s tick 抢同一把目录锁，用户写操作会抢不到而 500。
     * 待命实例不报错、不重试，等持有者心跳过期（或被强杀）后在下一个 tick 自然接管。
     */
    private kickAsCoordinator;
    onStop(): Promise<void>;
    /**
     * 房间轮次看门狗（每 tick 一次）。
     * 判据是「当前发言人的进程还在不在」——正常 turn 要 3–4.5 分钟，超时会误伤；
     * 进程消失才是确定性的断棒。决策在 agent-home-channel-turn-watchdog.ts（纯函数）。
     * 落盘在目录锁内、叫人在锁外（仓库纪律：唤醒永不持锁）。
     */
    private sweepRoomTurns;
    private sweepRoomTurnsOnce;
    private drain;
    private wake;
}
/**
 * 唤醒一只同事 job：活着就把暂存回复/误投收件箱搬进正式 inbox；不在就重拉（用户终止过的除外）。
 * 返回 true = 这张唤醒票可以消费掉（完成 / 人已不存在 / 用户终止过），false = 等下一次再试。
 *
 * 抽成模块函数的原因：消费唤醒票的两个入口共用它——常驻进程里的 broker 2s tick
 * （--serve / 同事 job 宿主），以及 **Agent Home HTTP 面被访问时的顺带 drain**
 * （见 drainColleagueWakeTicketsOnce）：TUI 内嵌 Web UI（host='cli'，argv 无 --serve）
 * 没有 broker 常驻循环，票只能靠面板请求顺路消化（2026-09-18 实发：
 * 任务指派后唤醒票没人消费，被指派人一直不被拉起）。
 */
export declare function wakeColleagueJob(input: {
    jobId: string;
    store: IJobStore;
    processManager: IDaemonProcessManager;
    log?: (message: string) => void;
    logInfo?: (message: string) => void;
}): Promise<boolean>;
/**
 * 一次性消费积压的唤醒票（幂等，可被多个入口重复调用）。
 *
 * 调用方负责两件事：门（orchestration 开关 / 宿主）与节流；本函数只做
 * 「peek → 逐张 wake → 成功即删票」。没票 / 单张失败都不抛错。
 *
 * 与 broker 的 2s tick 是同一份 wake 逻辑（wakeColleagueJob），差别只是触发时机：
 * HTTP 面在**打开 Agent Home 面板**时顺带跑一遍，覆盖没有常驻 broker 的宿主。
 */
export declare function drainColleagueWakeTicketsOnce(input: {
    homeDir: string;
    store: IJobStore;
    processManager: IDaemonProcessManager;
    log?: (message: string) => void;
    logInfo?: (message: string) => void;
}): Promise<number>;
