import type { McpConfig } from './mcp-protocol';
/**
 * 计算 MCP server config 的稳定指纹，用于判断同名 server 的配置是否发生变化。
 *
 * serverManager 按 name 缓存 server 实例；当一次会话内同名 config 被替换（最典型
 * 是 prewarm 命中后 connector-proxy 的 headers 从「无 Authorization」变为「带
 * Bearer」），必须据此重建实例而非复用 stale 实例（见 serverConfigFingerprint
 * 注释）。
 *
 * 仅纳入会影响 transport / 鉴权 / 工具行为的语义字段：
 * - `type` / `url`（http、sse）
 * - `headers`（静态 Authorization 决定是否挂 OAuth provider，是本 bug 的关键维度）
 * - `command` / `args` / `env`（stdio）
 * 对 headers / env 的 key 排序后序列化，避免对象键顺序抖动造成误判。
 */
export declare function computeMcpConfigFingerprint(config: McpConfig): string;
/**
 * 诊断用：算出两个 fingerprint 之间**变化的字段名**（不含值），供 rebuild 日志定位
 * "到底哪个字段变了触发了重建"。fingerprint 是 `computeMcpConfigFingerprint` 产出的
 * JSON 字符串（{type,url,headers,command,args,env}），此处 parse 回来逐字段比对；
 * headers / env 下钻到具体子 key。
 *
 * **只报 key 名，绝不打 value** —— headers/env 里常含 Authorization bearer、
 * session-id、connector token 等敏感值，落盘会泄漏。返回如
 * `headers.x-orchestrator-session-id, env.CODEBUDDY_AGENTOS_SESSION_ID`。
 * 解析失败时回退 `<unparseable>`，保证日志本身永不抛错。
 */
export declare function diffMcpConfigFingerprint(before: string, after: string): string;
