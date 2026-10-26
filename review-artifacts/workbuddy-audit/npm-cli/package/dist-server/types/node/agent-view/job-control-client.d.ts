/**
 * broker 控制 socket 的客户端原语。
 *
 * 刻意不依赖 DI、日志或任何会话基建：`SafeExitUtils` 这种最底层的工具也要
 * 能问一句「我是不是跑在 broker 里」，从 utils 反向 import 一个 DI 组件
 * 会绕成循环依赖。
 */
import { type AgentJobState, type JobControlRequest, type JobControlResponse } from './agent-view-protocol';
/**
 * broker 的本地控制 socket 路径。Windows 上是 named pipe。
 *
 * `generation` 区分同一 jobId 的不同 broker 代次：旧 inner 的看门狗与旧
 * broker 的 exit 钩子会按路径 unlink，若不带代次就会删掉新 broker 正在
 * 监听的文件。默认用调用方 pid（通常是 broker 自己）。
 */
export declare function brokerSocketPath(jobId: string, generation?: string | number): string;
/** Preserve the private temp directory boundary when a long TMPDIR needs a shorter path. */
export declare function prepareBrokerSocketPath(jobId: string, generation?: string | number): Promise<string>;
/** 开一条短连接发一条控制请求，读回一行应答。 */
export declare function sendControl(socketPath: string, request: JobControlRequest): Promise<JobControlResponse>;
/**
 * 请 broker 把 attacher 脱开。会话本身不受影响，继续在后台跑。
 *
 * 不是 broker 托管的会话返回 false，调用方据此走原本的退出路径。
 */
export declare function requestBrokerDetach(): Promise<boolean>;
/** Only the owning broker can accept reclamation; never fall back to a PID signal. */
export declare function requestIdleWorkerReclaim(state: AgentJobState, reason?: 'memory-pressure' | 'stale-state-probe'): Promise<boolean>;
export declare function requestStaleWorkerIdleProbe(state: AgentJobState): Promise<boolean>;
