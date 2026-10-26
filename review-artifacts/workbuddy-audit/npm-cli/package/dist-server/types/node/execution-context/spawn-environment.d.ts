/**
 * sandbox-cli daemon 启动时允许从宿主环境继承的变量。
 *
 * sandbox-cli 的用户命令环境通过 RunExecutable IPC 请求传入；daemon 本身不需要
 * 继承 cbc 的 Gateway、Provider、Session 或插件凭据。Windows 的环境键不区分大小写，
 * 具体投影逻辑由 projectSandboxCliEnvironment 处理。
 */
export { buildSandboxCliSpawnEnvironment, projectSandboxCliEnvironment, SANDBOX_CLI_ENV_KEYS } from '@genie/sandbox-cli/sandbox-cli-environment';
export { REQUEST_SCOPED_ENV_KEYS, W3C_PROPAGATION_ENV_KEYS, scrubRequestContextFromEnv } from './request-context-env';
/** Generic inherited-process adapter. Long-lived callers must use buildLongLivedProcessSpawnEnvironment. */
export declare function buildProcessSpawnEnvironment(boundaryInput?: Readonly<Record<string, string | undefined>>, boundaryOverride?: Readonly<Record<string, string | undefined>>, nodeOptionsChannel?: string): NodeJS.ProcessEnv;
/** Build an inherited environment for a process that outlives the current request. */
export declare function buildLongLivedProcessSpawnEnvironment(boundaryInput?: Readonly<Record<string, string | undefined>>, boundaryOverride?: Readonly<Record<string, string | undefined>>, nodeOptionsChannel?: string): NodeJS.ProcessEnv;
/**
 * 服务端专属、绝不能被嵌套 CBC 子进程继承的 key。
 *
 * `--serve` / daemon 启动时会把监听端口写入 `SERVER__PORT`（`server-mode-strategy`
 * 设置，`EndpointProvider` 在bind 后改写为真实端口）。若子进程原样继承，它会尝试
 * bind 同一个**已被父进程占用**的地址，然后**静默挂死**：不报错、不退出、无输出，
 * 事件循环上也没有 pending 请求，父进程只能等到 timeout 才发现。
 *
 * 实测（`-p --model lite`）：指向被占用端口必然挂死；指向空闲端口或不设置则 3 秒内正常退出。
 */
export declare const SERVER_ONLY_ENV_KEYS: readonly ["SERVER__PORT", "SERVER__HOST"];
/**
 * 为「嵌套 CBC 子进程」构造 spawn 环境：在 {@link buildProcessSpawnEnvironment}
 * 基础上剥离 {@link SERVER_ONLY_ENV_KEYS} 及父执行的 Broker 身份，保留运行时配置。
 *
 * 任何在可能已经监听端口的进程（serve / daemon）里 spawn 另一个 CBC 的调用方都应
 * 使用本函数，而不是直接透传 `process.env`。PTY 子 shell（`ptyEnv`）与 daemon
 * respawn（`daemon-process`）历史上各自做过同样的剥离，本函数是它们的统一形式。
 */
export declare function buildNestedCbcSpawnEnvironment(boundaryOverride?: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv;
