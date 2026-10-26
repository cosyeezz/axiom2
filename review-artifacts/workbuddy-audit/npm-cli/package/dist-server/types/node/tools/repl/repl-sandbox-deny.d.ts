/**
 * REPL 沙箱的「整工具级 deny」与「不进目录」判据 —— **一份实现，三处共用**：
 * 骨架目录（repl-catalog-source）、发现 API（repl-bridge-broker）、prompt 里的沙箱工具面。
 *
 * 为什么要抽出来：这三处原先各写一份，口径已经漂移 —— broker 用的是字面量字符串比较
 * （大小写敏感、不认 `Tool(*)` 形态、漏掉 MCP deny 规则），而骨架 / AgentManager 用的是
 * `PermissionUtils.matchPermissionRules`。结果是 `READ` 或 `mcp__github__*` 这类规则
 * 骨架里已经隐藏，`describeTool` / `searchTools` 却仍把 schema 交给模型。
 *
 * 口径与 `AgentManager.isToolDisallowed` 严格同源（它就是正常路径上摘工具的那一层）：
 * 名字（含 aliases）两侧统一小写，只有 `rule === '*'`（整工具级 / 通配）才整体隐藏；
 * 带参规则（`Bash(rm:*)`）留给执行期 ToolPermissionService Phase 1，工具必须留在目录里，
 * 否则模型连合法用法都看不到。
 *
 * ── 口径选择（#125667 评审，别当 bug 改回去）────────────────────────────────
 * - `Bash` 与 `Bash(*)` **都**是整工具级（`matchPermissionRules` 把括号里的内容当 rule，
 *   内容为 `*` 即整工具级）→ 一并隐藏。这与 `AgentManager.isToolDisallowed` /
 *   `buildTools` 的 `extractWholeToolRules` 一致。
 * - 裸 `'*'`（不带工具名）**不**隐藏任何工具：它不是任何工具的名字，`matchPermissionRules`
 *   匹配不到它，`AgentManager.isToolDisallowed` 同样不认。发现层此前把裸 `'*'` 当
 *   "全 deny" 是这一处独有的特例，已随本次归一化移除 —— "deny 全部"应写成 `Tool(*)`。
 */
import type { Session } from '../../../vendor/cbc-core/node/index.js';
/**
 * 合并本会话的全部 deny 规则来源，口径与 ToolPermissionService Phase 1 的
 * `allDenyRules = [...mergeRulesFromAllSources(denyRules), ...disallowedTools]` 同源。
 */
export declare function collectSandboxDenyRules(session: Session | undefined | null): string[];
/**
 * 名字（含别名）是否命中**整工具级** deny 规则。
 *
 * MCP 名走 `matchMcpPermissionRules`（精确 `mcp__server__tool` / 通配 `mcp__server__*` /
 * 裸 `mcp__server` / 全通配 `mcp__*` 都认），内置名走 `matchPermissionRules`（大小写不敏感、
 * `Tool(*)` 与裸 `Tool` 都算整工具级）。
 */
export declare function isWholeToolDenied(rules: string[], names: string[]): boolean;
/**
 * REPL 自己与 defer 机制的两个工具不进目录、也不可发现：
 * REPL 不能自我递归调用；ToolSearch / DeferExecuteTool 在沙箱里被 searchTools / describeTool
 * 取代，暴露它们只会让模型混淆两条调用路径（沙箱里也没有这些全局）。
 */
export declare function isHiddenFromReplCatalog(name: string): boolean;
