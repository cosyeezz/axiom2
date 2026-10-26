/**
 * REPL 沙箱「有效白名单」的收窄判据 —— **一份实现，两处共用**：
 * 骨架目录（repl-catalog-source）与发现 / 执行 API（repl-bridge-broker）。
 *
 * 为什么要抽出来：模式级列表（极简 Bash/Edit/Skill、PTC+overlay 协调器白名单）原先在
 * 两处被当成 agent / session 白名单的**替代品**（`allowedTools = [...sandboxTools]`）。
 * 子代理继承模式后这会把上游挡掉的工具放回来 —— 用户实测抓到 Explore 的 REPL 目录里出现
 * Edit。口径必须统一为**只收窄、不放宽**：模式列表与上游白名单取交集。
 *
 * 子代理 MCP 白名单判定（`isMcpToolAllowedForAgent`）在 `mcp/mcp-subagent-allowlist.ts`：
 * ToolSearch 也要用它，而 server 产物会把 `tools/repl/` 整个目录置空。
 */
/**
 * 模式级沙箱白名单与 agent / session 白名单取交集（纯函数，便于断言）。
 *
 * `allowedTools === undefined` = 上游「不过滤」（主会话 Code Mode 的常态）→ 直接用模式列表；
 * 否则只保留两边都有的（大小写不敏感），确保模式列表**只收窄、不放宽**。
 */
export declare function intersectModeSandboxTools(modeTools: readonly string[], allowedTools: string[] | undefined): string[];
