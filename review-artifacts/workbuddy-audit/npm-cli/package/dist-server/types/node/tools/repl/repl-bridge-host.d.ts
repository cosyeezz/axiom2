/**
 * RemoteBridgeHost —— BridgeHost 的真实现(agent-cli 侧客户端)。
 *
 * 传输 = 一条**本地 socket / 命名管道**(Unix domain socket / Windows 命名管道),零端口。
 * 由 spawn agent-cli 的一方(如 WorkBuddy)经 env 传入:
 *   - `CODEBUDDY_REPL_HOST_PIPE_PATH` —— Unix domain socket 路径(mac/linux)或命名管道 `\\.\pipe\...`(Windows)。
 *   - `CODEBUDDY_REPL_HOST_TOKEN`     —— 授权 token(**强制**)。
 * agent-cli 只 `net.connect(path)`(跨平台透明)、写 `{op,...,token}\n`、读 `<json>\n`。
 *
 * 安全:**token 强制**——host 是高权限(浏览器/电脑控制),裸 socket 会被同机其它进程利用。
 *   pipe 或 token 任一未配置 → 无桥(不连接)→ `import("@wb/x")` 抛 not available。
 * 跨平台:Node `net` 对 Unix socket / Windows 命名管道透明,由提供方按平台给正确的 path。
 * 二进制:参数/返回值里的 Uint8Array/ArrayBuffer 在 socket 边界自动 ⇄ `{ $bytes: base64 }`,对模型/桥透明。
 * 超时:单次桥调用超时随 cell 预算(opts.timeoutMs / opts.signal),不写死。
 * 端到端验证需真提供方 + 真能力(本环境不具备);此为客户端半边 + 协议契约。见 docs/repl-code-mode/bridge-contract.md。
 */
import { Logger } from '@genie/telemetry';
import { BridgeApiDescriptor, BridgeCallOpts, BridgeHost, BridgeInvokeRequest, BridgeResult } from './repl-protocol';
export declare class RemoteBridgeHost implements BridgeHost {
    protected readonly logger: Logger;
    listBridges(): Promise<string[]>;
    resolveBridge(specifier: string): Promise<BridgeApiDescriptor | null>;
    invokeBridge(req: BridgeInvokeRequest, opts?: BridgeCallOpts): Promise<BridgeResult>;
    /**
     * 一次连接一次请求:写 `{...,token}\n`,读 `<json>\n`。
     * pipe 或 token 未配置 → undefined(无桥,不连接)。失败/超时 → undefined(调用方降级)。
     */
    private post;
}
