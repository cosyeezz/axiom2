/**
 * Prewarm 模块协议定义
 *
 * 遵循项目 protocol pattern：所有 DI Symbols 和 interface 定义在此文件中，
 * 实现类在独立文件中 import 这些定义。
 *
 * 设计背景见 CODEBUDDY 对话记录 / docs：
 * 预热进程在唯一入口 `CliDispatcherImpl.onStart()` 处分流——完成阶段 A
 * （容器 init + auth + product base + user 级 MCP）后**不**调用 `dispatch()`，
 * 而是起一个 IPC 监听 server 挂起等待。外部进程通过 IPC 发送 `activate`
 * 消息（携带目标 cwd 与 CLI 参数），预热进程收到后 `process.chdir(cwd)`
 * 并执行 `dispatch()`——cwd 一生只绑定一次，因此天然规避了 project 级缓存
 * （settings / memory / MCP）的串味问题。
 */
import type { AtRestEncryptionBootstrapWire } from '@genie/at-rest-crypto';
export declare const PrewarmServer: unique symbol;
/**
 * 预热 standby 状态服务：回答"当前进程是否处于预热待命态"。
 *
 * 与运行模式（headless / TUI / serve / acp）**完全正交**——只判断"是否 prewarm
 * 待命"，各资源加载入口（skill / plugin / mcp 等）用它做统一的 standby noop 守卫，
 * 待命期短路不加载，activate 后由 {@link PrewarmActivationCoordinator} 统一 fire。
 */
export declare const PrewarmStateService: unique symbol;
/**
 * 预热 activate 协调者：收拢 activate 落定后的所有会话级资源"点火"处理，
 * 使 dispatcher 只需调一次 `fireActivation(activation)`。
 */
export declare const PrewarmActivationCoordinator: unique symbol;
/** 预热 IPC 地址前缀（与 sandbox-cli 的 `_resolveIpcPath` 约定保持同构）。 */
export declare const PREWARM_ADDRESS_PREFIX = "codebuddy-prewarm-";
/**
 * 自定义预热 socket 目录的 env 名。
 *
 * 默认 unix socket 落在 `/tmp/`。某些环境（如 `/tmp` 被 noexec / 只读挂载、
 * 或需要把 socket 放进受控目录做隔离/清理）需要改落盘目录。设置本 env 为一个
 * 目录路径后，unix socket 改为 `<dir>/codebuddy-prewarm-<id>.sock`。
 *
 * 仅影响 unix domain socket；Windows named pipe 命名空间无目录概念，不受影响。
 * 进程侧（创建 socket）与客户端侧（连接 socket）读取同一 env 保持同构。
 */
export declare const PREWARM_SOCKET_DIR_ENV = "CODEBUDDY_CODE_PREWARM_SOCKET_PATH";
/**
 * 单条 IPC 消息最大字节数。超过即视为异常输入，断开连接避免无界缓冲。
 * activate 消息只带 cwd + 一小段 args，1MB 远超实际所需。
 */
export declare const PREWARM_MAX_MESSAGE_BYTES: number;
/**
 * 预热进程生命周期状态：
 * - idle:      已完成冷启动，等待 activate
 * - activating: 收到 activate，正在 chdir + dispatch
 * - active:    已绑定 cwd 并进入正常服务（dispatch 已执行）
 */
export type PrewarmStatus = 'idle' | 'activating' | 'active';
/** 探活：`{ cmd: 'ping' }` → `{ ok: true, ... }` */
export interface PrewarmPingRequest {
    cmd: 'ping';
}
/** 查询状态：`{ cmd: 'status' }` → 返回当前 PrewarmStatus 与元信息 */
export interface PrewarmStatusRequest {
    cmd: 'status';
}
/**
 * 唤醒：绑定到目标 cwd 并以给定 CLI 参数执行 dispatch()。
 * 只允许成功一次；重复 activate 直接返回错误。
 */
export interface PrewarmActivateRequest {
    cmd: 'activate';
    /**
     * `ready` 时延迟响应，直到 ACP `/api/v1/acp` 初始化完成并返回真实 endpoint。
     * 省略时保持历史行为：收到 activate 后立即回 `status=activating`，兼容
     * `cbc-prewarm` / `wb-prewarm` 等短超时客户端。
     */
    ackMode?: 'ready';
    /**
     * 目标工作目录（绝对路径）。预热进程将 chdir 到这里。
     * 可选：省略时预热进程保持冷启动时的 cwd（不 chdir），适用于
     * 调用方无需切换目录、只想复用已预热容器的场景。
     */
    cwd?: string;
    /** 透传给 dispatch 的 CLI 参数（如 ['--serve', '--model', 'xxx']）。 */
    args?: string[];
    /** 可选：指定 session id。 */
    sessionId?: string;
    /**
     * 可选：在 activate 时合并到 `process.env` 的 env 增量。
     *
     * 用途：解决"预热进程 spawn 时还不知道 session 维度 env"的问题。
     * 预热进程冷启动时只能用一份"基线 env"，而真实会话需要的 env（如
     * connector token、agent-teams 开关）只有在 activate 时才确定。
     * 调用方把这些差异 env 通过 activate 传过来，预热进程 `Object.assign(process.env, env)`
     * 后再 dispatch；后续 agent-cli 派生的下游进程（MCP server、Bash 工具等）
     * 默认继承 `process.env`，因此能拿到正确的 env。
     *
     * 注意限制：
     * - 这里**只更新当前进程内存里的 process.env**，不会修改已在运行的子进程；
     * - 当前 process.execve 系统调用层面的 env 块**仍是冷启动时的旧值**，
     *   因此仅依赖原生层 env 的库（极少见）感知不到变化；
     * - 已活动的 dispatch 流程不会重新读 env——env 变更必须发生在 activate
     *   后、dispatch 之前。
     */
    env?: Record<string, string>;
    /** WorkBuddy-managed credential bootstrap; never transported through env or argv. */
    credentialProtectionBootstrap?: AtRestEncryptionBootstrapWire;
}
/**
 * 重配置：activate 后更新 cwd 和/或 env，用于 session 级预热场景。
 *
 * 预热池在 idle entry 上提前 activate（使用默认 cwd + 无 session delta env），
 * 令 CLI 进入 serve 模式并完成 ACP HTTP listen。当真实会话分配到该 entry 时，
 * 通过 reconfigure 把 cwd 和 env 增量切换到真实值，再由 daemon 侧做 ACP
 * connect + loadSession。
 *
 * 只允许在 `active` 状态下调用（activate 已完成、CLI 已在 serve）；
 * idle / activating 状态下调用直接返回错误。
 */
export interface PrewarmReconfigureRequest {
    cmd: 'reconfigure';
    /** 新的工作目录（绝对路径）。省略时保持 activate 时的 cwd。 */
    cwd?: string;
    /** 合并到 process.env 的 env 增量。 */
    env?: Record<string, string>;
}
export type PrewarmRequest = PrewarmPingRequest | PrewarmStatusRequest | PrewarmActivateRequest | PrewarmReconfigureRequest;
/** 统一响应包络。每条请求回一行 JSON。 */
export interface PrewarmResponse {
    ok: boolean;
    /** 命令回显，便于调用方对账。 */
    cmd?: PrewarmRequest['cmd'];
    /** 当前状态。 */
    status?: PrewarmStatus;
    /** 进程 PID。 */
    pid?: number;
    /** activate 成功后，已绑定的 cwd。 */
    cwd?: string;
    /** activate ready ACK 中的 ACP endpoint（固定为 `/api/v1/acp`，端口必须非零）。 */
    endpoint?: string;
    /** activate ready ACK 对应的 session id，供父进程校验响应身份。 */
    sessionId?: string;
    /**
     * activate → ready ACK 之间 cbc 侧各阶段耗时（ms），仅 ready-mode ACK 携带。
     * daemon 把它并入 `prewarm_hit` 事件属性，用于线上（尤其 Windows）定位
     * sidecar_ms 到底花在哪一段。字段可选、纯诊断，缺失不影响会话建立。
     */
    timings?: PrewarmActivateTimings;
    /** 失败时的错误描述。 */
    error?: string;
}
/**
 * prewarm activate 命中路径的阶段耗时分解（cbc 侧测量，ms）。
 *
 * 阶段边界（与 `cli-dispatcher.ts::runPrewarmStandby` 一一对应）：
 * - `preDispatchMs`：收到 activate → chdir + env merge + argv 重解析(applyPrewarmArgs)
 *   + fireActivation（USER MCP 缓存失效 / setCwdState 广播 / markActivated fan-out /
 *   outbound A2A discovery 异步点火）全部完成，即将进入 dispatch() 之前。
 * - `dispatchMs`：dispatch() 起 → ServeModeStrategy 完成 acpServer.start()
 *   + reportSidecarRuntimeReady，即将 flush ready ACK（markActive）之前。这段是
 *   CellJS Application.start() 的 onStart 链 + HTTP server listen，通常是大头。
 * - `totalMs`：收到 activate → 即将 flush ready ACK 的总耗时（≈ daemon 侧 sidecar_ms
 *   减去 IPC 往返网络开销）。
 */
export interface PrewarmActivateTimings {
    totalMs: number;
    preDispatchMs: number;
    dispatchMs: number;
}
/** 预热进程在 registry 中登记的元信息（kind === 'prewarm'）。 */
export interface PrewarmRegistryMeta {
    /** IPC 端点标识。 */
    prewarmId: string;
    /** 平台对应的 socket / pipe 地址。 */
    socketPath: string;
    /** 当前状态。 */
    status: PrewarmStatus;
}
/**
 * 同一 prewarmId 已有活进程在监听时由 `listen()` 抛出。
 *
 * 用途：让上层（CliDispatcher 预热分支）能区分「id 已被占用」与普通 IO 错误，
 * 从而给出明确提示并以非 0 退出码退出，而不是把活进程的 socket 抢删导致旧进程失联。
 */
export declare class PrewarmIdInUseError extends Error {
    readonly prewarmId: string;
    readonly socketPath: string;
    constructor(prewarmId: string, socketPath: string);
}
export interface IPrewarmServer {
    /**
     * 在已知地址上开启 IPC 监听，返回解析出的 socket/pipe 地址。
     * 幂等：重复调用返回同一地址。
     *
     * @param opts.force 同 prewarmId 地址上已有活进程在监听时：
     *        - false（默认）→ 抛 `PrewarmIdInUseError` 拒绝启动；
     *        - true → 不拒绝，直接 unlink 接管地址（杀旧进程由调用方在 listen 前完成）。
     */
    listen(prewarmId: string, opts?: {
        force?: boolean;
    }): Promise<string>;
    /**
     * 等待外部 activate 消息，resolve 出绑定参数。
     * onStart 在预热分支里 await 此 promise，拿到结果后再 chdir + dispatch。
     */
    waitForActivation(): Promise<PrewarmActivateRequest>;
    /**
     * ACP 业务路由初始化完成后回填状态，并向挂起的 activate 请求发送最终 ready ACK。
     *
     * 普通（非 prewarm）serve 进程、未请求 ready ACK、或 activate 客户端已断开
     * 时返回 false；这些情况均不影响已经 ready 的 serve 进程继续运行。
     */
    markActive(info: {
        cwd: string;
        endpoint: string;
    }): Promise<boolean>;
    /**
     * 记录 activate 命中路径的阶段边界时间戳，供 ready ACK 计算 `timings` 分解。
     *
     * 由 `cli-dispatcher.ts::runPrewarmStandby` 在阶段边界调用（纯诊断、幂等、
     * 非 prewarm 或未 activate 时静默忽略）：
     * - `'dispatch'`：fireActivation 完成、即将进入 dispatch() 之前。
     * `markActive` flush ACK 时以「activate 到达」为起点、以「本次 markActive」为终点，
     * 结合该边界切出 preDispatchMs / dispatchMs。
     */
    markActivatePhase(phase: 'dispatch'): void;
    /** 关闭 IPC server 并清理地址文件（Unix socket 文件）。 */
    close(): Promise<void>;
    /**
     * 同步版关闭 + 清理，专供进程退出钩子（`process.on('exit')`）使用。
     *
     * 退出钩子里事件循环已停止，异步 `close()` 跑到第一个 await 就会被 exit 截断，
     * 导致 unlink 永不执行、socket 文件残留。本方法全程同步（`unlinkSync`），
     * 保证 SIGINT/SIGTERM/正常退出路径下 socket 一定被清理。
     * 与异步 `close()` 互补；SIGKILL 无法捕获，残留交给下次同 id 启动的 listen() 自愈。
     */
    closeSync(): void;
    /** 当前状态。 */
    getStatus(): PrewarmStatus;
}
/**
 * 预热 standby 状态判定服务接口。
 *
 * 各资源加载入口（skill / plugin / mcp / product provider 等）在"真正读磁盘 /
 * 装配"的懒方法首行调 `isStandby()`——为 true 时短路返回空，不加载任何资源。
 * activate 落定时 {@link IPrewarmActivationCoordinator.fireActivation} 会调
 * `markActivated()` 解除待命，之后守卫失效、资源正常加载。
 *
 * 判定与运行模式无关：只看进程是否处于 `--prewarm` 待命且尚未 activate。
 */
export interface IPrewarmStateService {
    /**
     * 当前是否处于预热待命态。
     *
     * = `!activated && process.argv.includes('--prewarm')`。用 argv 而非纯布尔：
     * activate 时 `applyPrewarmArgs` 会剔除 `--prewarm`，argv 侧天然翻转；
     * `markActivated()` 只是把 latch 提前拍死做双保险。
     */
    isStandby(): boolean;
    /**
     * 注册"激活后"回调。standby 期由各资源在自己的 @PostConstruct 里调用，
     * 把"activate 后如何重新加载自己"内聚在资源自身。
     *
     * handler 必须是**非阻塞点火**：activate 后真实的资源加载都是 defer/promise 语义
     * （懒加载 / whenReady / deferred），handler 只负责触发这些 deferred 并立即返回，
     * 真正的 await 发生在各自消费点。**不要**在 handler 里 await 完整加载——会阻塞
     * activate 主流程并可能与 CellJS start 构成环。
     *
     * **无 priority**：handler 按注册顺序 fire，而注册顺序 = 各 Component @PostConstruct
     * 执行顺序 = DI 模块解析顺序 = 冷启动初始化顺序。activate 因此天然按与冷启动一致的
     * 顺序点火各资源，无需显式排序。
     */
    onActivated(handler: () => void): void;
    /**
     * activate 落定后调用一次（幂等）：置 activated=true（此后 isStandby() 恒 false），
     * 再按注册顺序**非阻塞**依次 kick off 所有已注册 handler（不 await，见 onActivated）。
     */
    markActivated(): void;
}
/**
 * 预热 activate 协调者接口。
 *
 * 把 activate 落定后的会话级资源"点火"处理收拢到一处，dispatcher 只需调一次。
 * 内部严格保持生产实证过的落定顺序：MCP USER 缓存失效 → product resync →
 * cwd 广播 → plugin runtime refresh → markActivated → 异步点火 outbound A2A discovery。
 */
export interface IPrewarmActivationCoordinator {
    /**
     * 触发 activate 后的全部资源处理。
     *
     * @param activation 外部传入的 activate 请求（此刻 chdir / env merge / argv
     *   重写均已由 dispatcher 完成，本方法只负责"点火"下游资源加载）。
     */
    fireActivation(activation: PrewarmActivateRequest): Promise<void>;
}
/**
 * 解析预热 IPC 地址为平台对应路径。
 * Windows: \\.\pipe\codebuddy-prewarm-<id>
 * Unix:    <dir>/codebuddy-prewarm-<id>.sock（<dir> 默认 /tmp，
 *          可由 CODEBUDDY_CODE_PREWARM_SOCKET_PATH env 覆盖）
 *
 * 与 sandbox-cli-client._resolveIpcPath 保持同构，便于外部调用方复用同一套规则。
 */
export declare function resolvePrewarmIpcPath(prewarmId: string): string;
/**
 * 解析 unix socket 落盘目录：优先取 CODEBUDDY_CODE_PREWARM_SOCKET_PATH env
 * （去掉首尾空白，允许带尾斜杠——join 会归一化），未设置或为空则回退 `/tmp`。
 */
export declare function resolvePrewarmSocketDir(): string;
/**
 * 预热进程发现目录：复用 daemon 的 `~/.codebuddy/sessions/`，
 * 通过 PidFileEntry.kind === 'prewarm' + meta 暴露 socketPath / status，
 * 外部调用方扫此目录即可发现所有 idle 预热进程，无需硬编码 id。
 *
 * 这里只给出默认根目录；真正写入由 SessionRegistry 负责（保持单一写入方）。
 */
export declare function getDefaultSessionsDir(): string;
