/**
 * 宿主自定义工具 helper（/server 出口自带，2026-08-23 用户裁决：宿主只消费
 * `@tencent-ai/agent-cli/server`，不摸 @genie/agent-sdk-js——那是跨进程 SDK
 * 产品的面）。API 与 agent-sdk-js 的 tool()/createSdkMcpServer() 保形（同源
 * 移植），返回值 `{type:'sdk', name, instance}` 直接就是 QueryOptions.mcpServers
 * 的合法条目：
 *
 * ```ts
 * import { tool, createSdkMcpServer } from '@tencent-ai/agent-cli/server';
 * const custom = createSdkMcpServer({ name: 'custom_tools', tools: [
 *     tool('show_widget', 'Show a widget by id', { widgetId: z.string() },
 *         async args => ({ content: [{ type: 'text', text: `shown ${args.widgetId}` }] })),
 * ] });
 * await server.query(sid, prompt, { mcpServers: { custom_tools: custom } });
 * ```
 *
 * 运行形态：内核 SdkMcpServer 识别 instance 后走 InMemoryTransport 进程内
 * 直连（无 control 通道、无子进程）；handler 在宿主进程执行，闭包可直达
 * 宿主对象（dataFs/sandboxFs 等）。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SdkMcpToolDefinition } from './tool-definition';
export { tool } from './tool-definition';
export type { AnyZodRawShape, InferShape, SdkToolHandler, SdkMcpToolDefinition } from './tool-definition';
export interface SdkMcpServerOptions {
    name: string;
    version?: string;
    tools?: Array<SdkMcpToolDefinition<any>>;
}
/** createSdkMcpServer 的返回——同时是 QueryOptions.mcpServers 的合法条目。 */
export interface SdkMcpServerResult {
    type: 'sdk';
    name: string;
    instance: McpServer;
}
/**
 * tools 混合形（E25 续，用户拍板 2026-08-23）：`tools` 数组同时接受内置工具名
 * （string / `Defer(X)` 文法）与 `tool()` 定义。分拣结果：
 * - whitelist：字符串项 + tool() 项的名字（写进数组即入白名单，模型可见面
 *   由同一份列表定义）；
 * - defs：tool() 项——上游装配成隐式 `custom_tools` SDK server（transparent_proxy
 *   + builtin_tools 裸名直传，模型看到的就是 `show_widget` 这样的裸名）。
 * 碰撞防线（flue 同则，重名即 throw）：tool() 项互相重名、或与同数组的内置
 * 名（含 Defer 解包后）重名，都在装配期响亮失败。
 */
export declare function partitionToolsOption(tools: ReadonlyArray<string | SdkMcpToolDefinition>): {
    whitelist: string[];
    defs: SdkMcpToolDefinition[];
};
/**
 * tool() 定义集的内容签名——会话内每刷比对用（重挂判据的一半）。签名取可观察
 * 契约面（名字/描述/schema 键集）；同名同形换 handler 不触发重挂（文档约束）。
 */
export declare function toolDefsSignature(defs: ReadonlyArray<SdkMcpToolDefinition>): string;
/** 把一组 tool() 定义装配成进程内 MCP server 实例。 */
export declare function createSdkMcpServer(options: SdkMcpServerOptions): SdkMcpServerResult;
