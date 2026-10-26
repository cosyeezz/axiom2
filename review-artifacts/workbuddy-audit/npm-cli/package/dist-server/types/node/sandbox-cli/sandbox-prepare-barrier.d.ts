/**
 * session 级沙箱准备 barrier 注册表。
 *
 * 独立成模块（而非放在 sandbox-interceptor.ts）是为了避免循环依赖：
 * SandboxAgentRunInterceptor（agent/interceptors）依赖 sandbox-cli 包的
 * lifecycle/rule-sync 等，而消费侧（SandboxShellService 等，sandbox-cli 包）
 * 需要 await barrier。注册表本身零依赖，两侧各自引它。
 *
 * 语义见 {@link waitForSandboxSessionPrepared}：
 * - 正常时序（模型首条 toolcall 距 runner start 实测 ≥2.7s，准备链 <300ms）
 *   await 立即通过；
 * - 竞态时序等待真实剩余差值，避免按默认 useSandboxCLI=false 静默走本地；
 * - 失败已在链内降级完成，等待侧吞掉异常。
 */
/**
 * 注册 session 的准备 barrier。
 *
 * single-flight：存在**未过期**的 barrier 时复用现存 promise；挂死残留
 * （年龄超 BARRIER_MAX_AGE_MS，上一轮被保险丝判过死刑的死链）则替换——
 * 复用死链会让后续所有轮次都不再启动新准备（见
 * getReusableSandboxSessionPrepareBarrier 注释）。settle 后自动清除。
 * 调用方需自行挂 catch（barrier 不抛错时也应清理）。
 */
export declare function registerSandboxSessionPrepareBarrier(sessionId: string, barrier: Promise<void>): Promise<void>;
/** 仅查询（不注册）：session 当前是否存在未 settle 的准备 barrier。 */
export declare function getSandboxSessionPrepareBarrier(sessionId: string): Promise<void> | undefined;
/**
 * 查询是否存在**可复用**的准备 barrier：存在且年龄在挂死上限内。
 *
 * 供 kickoff 的 single-flight 复用判定：挂死链（既不成功也不失败）永不
 * settle，也不会从注册表清除——若只按「存在」复用，挂死的那一轮会永久
 * 污染后续所有轮次（每轮 reusing 一个死 barrier、不启动新准备、命令
 * 永久降级本地，PR 评论拦截的缺陷）。年龄超过 BARRIER_MAX_AGE_MS 的
 * barrier 视为残留：调用方应重新发起准备（注册时会替换旧条目）。
 */
export declare function getReusableSandboxSessionPrepareBarrier(sessionId: string): Promise<void> | undefined;
/**
 * 等待指定 session 的沙箱准备链完成（若存在且未 settle）。
 *
 * @returns true = 链已 settle（或不存在——本就无需等待）；
 *          false = 等待超时（链仍在飞/挂死），调用方按各自兜底口径处理
 *          （bash：直接降级本地，自愈交给下一轮 turn-start）。
 *
 * 失败不会抛出——降级已在链内完成，这里只等状态落定。
 */
export declare function waitForSandboxSessionPrepared(sessionId: string | undefined, timeoutMs?: number): Promise<boolean>;
/**
 * 消费侧兜底等待的挂死保险丝（统一口径，所有工具共用）。
 *
 * 不是独立的降级超时——链内部的 10s 截止（经 BootstrapOptions.deadlineMs 落在
 * lifecycle promise 上）才是「成功/失败」的唯一裁决点，失败会在 10s 内 settle。
 * 这个值只拦「链既不成功也不失败」的挂死场景（缺超时的 IO 段等，含 deadline
 * 计时开始前的段如 settings 读），= 链预算 10s + 余量。原值 3s 对应链预算 2s，
 * #150218 链预算恢复 10s 后同步放大（不再留 15s 长默认——那会让 grep/写保护/
 * 权限比 bash 多挂 12s）。
 */
export declare const PREPARE_WAIT_FUSE_MS = 12000;
