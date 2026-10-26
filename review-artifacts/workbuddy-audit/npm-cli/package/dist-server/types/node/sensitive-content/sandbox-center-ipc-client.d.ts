import { SandboxCenterClientBase, type SandboxCenterRequestOptions, type SandboxCenterRuntimeContext } from '@genie/sandbox-cli/sandbox-center-client';
export { type SandboxCenterRequestOptions, type SandboxCenterRuntimeContext, };
export { SandboxCenterIpcClient } from './sandbox-center-ipc-client-protocol';
/**
 * standalone 常驻进程（`--serve` daemon）启动即物化纪元地址并钉住 spawn-if-missing。
 * job worker 由它派生：首个 job 之前不物化，job 会各以自身 pid 自立纪元，同 uid
 * 多 center 互抢数据锁（#126618）；物化后整棵子树共用 daemon 的纪元地址。
 * Desktop / 已注入地址 / 显式 connect-only 的宿主拓扑不受影响。
 */
export declare function materializeStandaloneCenterEpochAddress(): void;
export declare class SandboxCenterIpcClientImpl extends SandboxCenterClientBase {
    constructor();
    protected resolveRuntimeContext(options?: SandboxCenterRequestOptions): SandboxCenterRuntimeContext;
}
