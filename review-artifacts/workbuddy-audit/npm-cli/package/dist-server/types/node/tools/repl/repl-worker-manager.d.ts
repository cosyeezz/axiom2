/**
 * REPLWorkerManager 实现(checkpoint 2b:常驻 Bun worker,perf/错误隔离)。
 *
 * - 每个 session 一个常驻 worker = kernel,里面一个持久 vm.Context = cell,状态跨多次 run 存活。
 * - worker 建在 @genie/cbc-worker 的 kit 上(rpc + 加固 realm),只用 builtins;acorn 的 import() 改写在主线程做好再发进去。
 * - 主线程侧是 @genie/cbc-worker 的 WorkerHost:exec 是带 rid 的请求,__replImport / facade / 工具调用是
 *   worker → host 的请求恢复当前 cell 的调用方上下文 → broker.resolve / broker.invoke / broker.callTool。
 *   帧见 repl-worker-protocol.ts。心跳只在没有 active cell 时计缺失(cell 同步占线程时 pong 发不出来)。
 * - lifecycle:cell 超时/取消只结束这次 cell(abort 它在途的 bridge 调用让它 unwind),kernel 和状态都留着;
 *   只有 worker 崩溃/退出,或 hard abort(= reset),才销毁 worker、下次 run 重建。像 Jupyter / node_repl 的 kernel。
 *
 * 见 docs/repl-code-mode/architecture.md。
 */
import { Session } from '../../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { ReplCatalogSource } from '../../agent/code-mode-protocol';
import { ToolResultBlobService } from '../../blob-store/tool-result-blob-service';
import { ToolSearchService } from '../tool-search-protocol';
import { CellResult, REPLBridgeBroker, REPLRunOptions, REPLWorkerManager } from './repl-protocol';
export declare class REPLWorkerManagerImpl implements REPLWorkerManager {
    protected readonly logger: Logger;
    protected readonly broker: REPLBridgeBroker;
    protected readonly catalogSource: ReplCatalogSource;
    protected readonly toolSearchService: ToolSearchService;
    protected readonly toolResultBlobService?: ToolResultBlobService;
    private readonly workers;
    private callSeq;
    run(context: RunContext<Session>, code: string, opts: REPLRunOptions): Promise<CellResult>;
    /** 取消当前 cell:软取消(默认)结束这次 cell、保留 kernel;硬取消(hard=true)销毁 worker,下次 run 重建(= reset)。 */
    abort(session: Session, _callId: string, hard?: boolean): void;
    dispose(session: Session): Promise<void>;
    /**
     * 记一次 bridge 交互的起讫,驱动 idle 超时:发起 inflightBridges++,结算 --并刷新 lastBridgeActivity。
     * 有在途调用(inflightBridges>0)idle 就续期,故 AskUserQuestion 等用户、长任务在途都不会被超时打断。
     * active 用发起时捕获的引用——即便结算时 cell 已被换,写旧 active 也无副作用(其计数已无人读)。
     */
    private withBridgeActivity;
    private ensureWorker;
    /**
     * 把当前工具集同步进 sandbox。
     *
     * 首次是全量 `init`；之后 `(epoch, 能力指纹)` 变了才推 `toolsUpdate` 增量。cell 执行中到达的
     * 变更排队到 `done` 之后（见 flushPendingTools）——否则模型 code 跑到一半时
     * `const g = github` 脚下的对象会被换掉。
     *
     * 为什么键里要有能力指纹：工具可见性不止由索引/overlay 版本决定（房间类工具还要看
     * Agent Home 表面 / 身份 / 已加入频道），那些变化不推进任何 epoch。只比 epoch 会让新
     * 加入频道的会话永远拿不到 SpeakInChannel（见 repl-sandbox-capability 头注释）。
     */
    private syncTools;
    /** cell 结束后补推排队的工具变更。 */
    private flushPendingTools;
    /**
     * 推一次进度快照给本次 run 的 onProgress。
     *
     * 带 `callId` 校验：进度定时器/异步消息可能在 cell 已被 abandon（超时/取消）或换成
     * 下一次 run 之后才触发，此时 entry.active 已是别的 cell 或 undefined，不能误推。
     * 回调异常一律吞掉——UI 侧问题绝不能影响 cell 执行。
     */
    private emitProgress;
    private postCatalog;
    private bindWorkerHandlers;
    /** 发现类 API 分流。只读，不过权限判定（把关的是可见性，见 §4.8）。 */
    private dispatchReplApi;
    /**
     * exec 回执的 async 收尾：只认当前 cell（被 abandon 的旧 cell 的回执已被 WorkerHost 丢弃，
     * callId 不符的也直接丢，别误清新 cell 的 active）。
     *
     * 在 settle 前把 spill 文件收口（追加 result 文本 + 判定截断），这样上层拿到
     * CellResult.persisted 时文件已完整可读。
     */
    private handleDone;
    /** 被放弃 cell 的 continuation 终于 unwind 完：worker 已自行收尾，取消宽限、不必 terminate，kernel 状态保留。 */
    private onUnwound;
    /** 执行期把完整 stdout/stderr 流式落盘（懒创建：无输出的 cell 不产生文件）。 */
    private pushSpill;
    /**
     * 收尾本次 run 的 spill 文件：
     * 1. 把完整 result 文本追加进文件（模型面只剩 head/tail 时，完整内容留给 Read）；
     * 2. 关闭文件流；
     * 3. 任一 buffer 截断且落盘成功 → 返回 persisted（上层把模型面收敛为占位符）；
     *    未截断 / 落盘失败 → 删除临时文件，不产生垃圾。
     *
     * result 截断判定与 buildReplToolContent 的 truncateReplResult 同口径
     * （replResultToText 文本的 UTF-8 字节数超本次 run 的输出预算）。
     */
    private finalizeSpiller;
    private createSpiller;
    /** 中止/失败的 cell 不留落盘文件（内容不完整，Read 也没有意义）。 */
    private cleanupSpiller;
    /** cell 超时/软取消:让这次 cell 以错误结束,并 abort 它在途的 bridge 调用(cell 的 await 会抛错、自行 unwind);
     *  worker(= kernel)保留,vm.Context 里的状态不丢——像 Jupyter / node_repl 那样。真卡死(CPU 打满)时靠 hard abort 重建。 */
    private abandonCell;
    /** 起 unwind 宽限；到期 worker 仍未发回 unwound 就 terminate 重建。 */
    private armAbandonGrace;
    /** 清 unwind 宽限计时器（收到 unwound / hard abort / 崩溃时调用；不动 abandonedCallId）。 */
    private clearGrace;
    /** 失败当前运行(崩溃/退出/dispose);active 的 promise 以错误态 settle，并清理 abandon 宽限。 */
    private failActive;
    /** 销毁 worker(崩溃/退出,或 hard abort / reset)并下线;下次 run 重建。 */
    private killWorker;
}
