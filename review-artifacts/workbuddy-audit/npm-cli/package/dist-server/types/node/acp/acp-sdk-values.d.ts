import type { AgentSideConnection as AgentSideConnectionTypeCtor, ndJsonStream as ndJsonStreamTypeCtor, PROTOCOL_VERSION as PROTOCOL_VERSION_TYPE, RequestError as RequestErrorTypeCtor } from '@agentclientprotocol/sdk';
export type AgentSideConnection = InstanceType<typeof AgentSideConnectionTypeCtor>;
export type RequestError = InstanceType<typeof RequestErrorTypeCtor>;
export declare let AgentSideConnection: typeof AgentSideConnectionTypeCtor;
export declare let RequestError: typeof RequestErrorTypeCtor;
export declare let ndJsonStream: typeof ndJsonStreamTypeCtor;
export declare let PROTOCOL_VERSION: typeof PROTOCOL_VERSION_TYPE;
/**
 * 拉起 @agentclientprotocol/sdk lazy chunk 并 assign runtime 值到 export let。
 * 幂等，并发 caller 复用同一次加载 promise。
 *
 * 挂载点：acp-server / acp-stream-manager / acp-agent 的公开入口（都在 activate
 * 后 async 上下文），加一次 `await preloadAcpSdk()` 即可；深层同步 caller
 * （如 sync method 里 `new AgentSideConnection(...)`）由外层入口预热保护。
 */
export declare function preloadAcpSdk(): Promise<void>;
