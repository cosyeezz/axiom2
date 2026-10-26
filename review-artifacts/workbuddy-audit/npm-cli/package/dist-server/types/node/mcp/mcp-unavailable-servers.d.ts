import { type McpServerModel } from './mcp-protocol';
/**
 * stream-json `system/init.mcp_servers_unavailable` 的元素：本轮开始时**未连上**的
 * MCP server 及其原始 `McpServerStatus`（`disconnected` / `unauthorized` /
 * `pendingApproval` / `pending` / `connecting` / `authorizing`）。
 *
 * 为什么放在 init 而不是新事件：init 只在 stream-json 链路出现（ACP / TUI / Web UI
 * 都不经过），每轮一条，是 sandbox-proxy 已经在记的那一行；既有 `mcp_servers`
 * 只列连上的（且 status 硬编码 'connected'），调用方分不清「没配」和「配了连不上」。
 *
 * 刻意**不带 `error` 文本**：它来自远端 MCP server、不受控且未脱敏，而 init 会进
 * proxy 日志与 stdio 持久化。归因需要的具体错误在 cbc 自己的日志
 * （`[MCP][cacheDbg] doConnect FAIL`）里按 pid 可查。
 *
 * 用户手动禁用的 server 同样表现为 `disconnected`，这里不区分：区分要走
 * `McpToggleManager.isDisabled()`，它会同步读配置文件，放进每轮 init 有性能代价。
 */
export interface UnavailableMcpServer {
    name: string;
    status: string;
}
/** 纯函数：从快照里挑出未连上的 server，按 name 排序；没有则返回 undefined。 */
export declare function collectUnavailableMcpServers(models: readonly McpServerModel[]): UnavailableMcpServer[] | undefined;
/**
 * 读取**当前已发布**的 MCP 快照并挑出未连上的 server。
 *
 * 性能约束（不要破坏）：全程同步、纯内存，只读 `serverCollectionSubject` 的当前值——
 * 不 await、不做 IO、不调 `list()` / `waitForPendingServers()` /
 * `getConnectedServers()`，因此绝不会让 init 等 MCP 建联或触发 projection。
 * 还在连的 server 就如实报 `connecting`。McpManager 按需惰性取（不在构造期注入，
 * 不改变启动期构造顺序）；取不到、快照不是 BehaviorSubject、或任何异常都返回
 * undefined —— init 照常发出，只是不带本字段。
 */
export declare function readUnavailableMcpServers(): UnavailableMcpServer[] | undefined;
