/**
 * Single source of truth for the shipped main-agent modes.
 *
 * These definitions are consumed at runtime by `BuiltinMainAgentModesProvider`
 * so the four modes travel with the CLI itself and do not require patching
 * tracked `build/patches/<env>/product*.json` files.
 */
import { Agent } from '@genie/product';
/** Runtime product fields stay English; Web/ACP Chinese lives in locale overlay. */
export declare const CLI_DISPLAY_NAME = "Standard";
export declare const CLI_DESCRIPTION = "Full coding agent: edit files, run commands, search code and the web, plus Skills, plans, goals, and sub-agents.";
/**
 * Code Mode (PTC / Minimal) prompt strategy.
 *
 * Base stays `cli-agent-prompt` (content policy / env / language / output style).
 * That template teaches native Bash/Read/Glob, so `rewriteCliPromptForCodeMode`
 * overlays it at render time. The REPL-only contract itself is `PTC_APPEND` /
 * `MINIMAL_APPEND` — also appended after the base because `--system-prompt`
 * replaces only the base.
 */
/** Shipped mode ids that exist only as the main-agent feature (not product default `cli`). */
export declare const SHIPPED_STANDING_MODE_NAMES: readonly ["ptc", "minimal", "create", "multitask"];
export type ShippedStandingModeName = (typeof SHIPPED_STANDING_MODE_NAMES)[number];
export declare function isShippedStandingMode(name: string | undefined): boolean;
/**
 * 带产品身份的 shipped 模式。只有名字不够：历史用户/插件 Agent
 * 可能恰好叫 ptc/minimal/create，它们必须保留旧运行语义。
 */
export declare function isShippedStandingModeAgent(agent: {
    name?: string;
    tags?: readonly string[];
} | undefined): boolean;
/**
 * 所有 Code Mode（PTC / Minimal）的模型面直连工具：只有 REPL。
 *
 * 这是「模型能直接调什么」的唯一来源，被 `codeModeSpecOf` 消费；不要在
 * agent-manager / repl-tool 里另写一份等价判据（历史上正是那样漂移出
 * 「minimal 工具面为空」的问题）。
 */
export declare const CODE_MODE_DIRECT_TOOLS: readonly ["REPL"];
/**
 * 极简模式在 **REPL 沙箱内**暴露的内置工具。
 *
 * 注意语义：这不是直连工具面（直连面是 `CODE_MODE_DIRECT_TOOLS`）。旧名
 * `MINIMAL_DIRECT_TOOLS` 会诱导调用方把它当成 LLM 工具列表白名单来用。
 * Skill 作为与标准对齐的附加上下文注入；MCP 不占本白名单，且极简保持关闭
 * （仅 PTC 全量开放 MCP）。
 */
export declare const MINIMAL_REPL_TOOLS: readonly ["Bash", "Edit", "Skill"];
export declare const MINIMAL_REPL_TOOL_SET: Set<string>;
/** overlay 叠在极简上：沙箱 = Bash/Edit/Skill + 协调器派工；不含 Grep/Read。 */
export declare const MINIMAL_OVERLAY_REPL_TOOLS: readonly ["Bash", "Edit", "Skill", "Agent", "TaskOutput", "TaskStop", "InterruptAgent", "ListAgents", "InspectSelf", "AskUserQuestion", "SendUserMessage"];
/** overlay 叠在 PTC 上：沙箱 = 协调器白名单，不是站立 PTC 全量目录。 */
export declare const PTC_OVERLAY_REPL_TOOLS: readonly ["Agent", "TaskOutput", "TaskStop", "InterruptAgent", "ListAgents", "InspectSelf", "AskUserQuestion", "SendUserMessage", "Grep", "Read"];
/** 该工具是否在极简模式的 REPL 沙箱内可用。 */
export declare function isMinimalReplTool(name: string | undefined): boolean;
export declare const MINIMAL_APPEND: string;
/**
 * 极简 + 委托 overlay 的契约。heading 与 MINIMAL_APPEND 相同，
 * 已写入 base 时 appendInstructionsIfMissing 会跳过 MINIMAL_APPEND，不会叠出两套工具面。
 */
export declare const MINIMAL_DELEGATE_APPEND: string;
export declare const PTC_APPEND: string;
/**
 * PTC 骨架目录摘要（SUMMARY_MAX_CHARS=80，关键句必须打头）。
 * Agent 失败在沙箱里 throw，不能靠模型去 `r.taskId ?? r.id`。
 */
export declare const PTC_TOOL_DESCRIPTION_OVERRIDES: Readonly<Record<string, string>>;
/**
 * Product Bash/Edit templates still teach Read; minimal has no Read.
 *
 * These overrides land on the **sandbox** copies of Bash/Edit (minimal has no
 * direct tools besides REPL), so `ToolManager.getToolDescription` is consulted
 * for them via the REPL catalog — see `ReplCatalogSource.describeForCatalog`.
 * Keys must be a subset of `MINIMAL_REPL_TOOLS`（Skill 用产品描述，不需要覆盖）.
 */
export declare const MINIMAL_TOOL_DESCRIPTION_OVERRIDES: Readonly<Record<string, string>>;
export declare const CREATE_APPEND: string;
export declare const MULTITASK_COORDINATOR_TOOLS: readonly ["Agent", "TaskOutput", "TaskStop", "InterruptAgent", "ListAgents", "InspectSelf", "AskUserQuestion", "SendUserMessage", "Grep", "Read"];
export declare const MULTITASK_APPEND: string;
/** overlay 叠在 PTC 上：替换 PTC_APPEND。heading 必须仍是 `# PTC / Code Mode`。 */
export declare const PTC_OVERLAY_APPEND: string;
/**
 * overlay 叠在 Code Mode 上的协调器 REPL 契约（与 MULTITASK_APPEND 分流）。
 * 不要在 rewriteCliPromptForCodeMode 之后再拼这一份：heading 不同，
 * appendInstructionsIfMissing 去重挡不住，会和 PTC_OVERLAY_APPEND /
 * MINIMAL_OVERLAY_APPEND 叠出两套 TaskOutput 口径。
 */
export declare const MULTITASK_CODE_MODE_APPEND: string;
/** 极简 + overlay：在 MINIMAL_APPEND 之上允许协调器工具，但仍禁止 Read/Grep/MCP。 */
export declare const MINIMAL_OVERLAY_APPEND: string;
/** 覆盖产品模板：stock Agent 教「先 Read/Bash」、TaskOutput 教 block=true 轮询。 */
export declare const MULTITASK_TOOL_DESCRIPTION_OVERRIDES: Readonly<Record<string, string>>;
/**
 * Build the three inserted mode agents from the current `cli` agent definition.
 *
 * - PTC and Minimal are both Code Mode: exactly one direct tool, REPL. What
 *   differs is the sandbox surface (PTC = everything, Minimal = Bash/Edit/Skill, no MCP),
 *   which `codeModeSpecOf` owns — not this file.
 * - Create inherits the full cli toolset and adds authoring guidance.
 */
/**
 * 模式自有字段：由模式定义显式覆写，其余字段全部从基座（产品默认 agent）继承。
 * 白名单拷贝会随 Agent 接口/产品配置增长静默丢字段（审计：接口 25 个字段旧实现只落位 8 个，且任意未来字段必丢）。
 */
export declare const MODE_OWNED_KEYS: readonly ["name", "displayName", "description", "instructions", "appendInstructions", "tags", "tools", "commands"];
/** 明确不继承的字段：子代理 / 工具与生命周期语义，主模式继承会改变主会话行为。 */
export declare const MODE_STRIPPED_KEYS: readonly string[];
/**
 * 刻意保留继承（不在剔除表里，别当遗漏）：
 * `memory` —— 主模式同样要记忆段落。注意副作用：显式 tools 白名单下记忆注入会回填
 * Read/Write/Edit（agent-manager.ts:2152-2153），对 ptc/minimal 的 Code Mode 契约
 * （直连面只有 REPL）意味着工具可见但运行时仍被门控拒绝。出货默认 Agent 不带 `memory`，
 * 故今天不可达；若要让模式自带记忆语义，需同步记忆注入与 Code Mode 门控两处。
 */
/** 数组字段必须拷新引用：共享引用会被就地改写（审计已复现 models/tags 污染）。 */
export declare const MODE_ARRAY_KEYS: readonly string[];
/**
 * 基座解析，顺序对齐引擎的默认 Agent 解析（rebuild 路径 agent-manager.ts:1904-1907，
 * 元信息快照路径 :3058）：先按 `cli` 身份标签过滤（跳过 `sub-agent` 标记的子代理定义），
 * 再取带 `default` 者，再退首个 `cli` 标签项；最后兜底 `name === 'cli'`，兼容旧配置。
 *
 * 跳过 `sub-agent`：workbuddy-custom 等配置里子代理也会带 `cli` 标签（如 enhance-prompt），
 * 它不是默认 Agent，不能当模式基座。
 *
 * 已知边界：配置里同时存在多个 `cli` + `default` 时，rebuild 取最后一个（:1904-1907 无 break），
 * 本函数取第一个 —— 基座与运行时默认 Agent 会分叉。出货配置只有一个默认 Agent，故不可达；
 * 若将来出现该形态，两处需一起对齐。
 */
export declare function resolveModeBaseAgent<T extends {
    name?: string;
    tags?: readonly string[];
}>(agents: readonly T[]): T | undefined;
export declare function buildModeAgents(cli: Agent): Agent[];
/**
 * 注册前补齐 / 刷新 shipped 模式。
 * 只刷新带 `main-mode` 身份标签的库存定义；同名的用户、插件、
 * CLI/SDK Agent 都是旧能力面，不得因为恰好叫 ptc/minimal/create 就被覆盖。
 * 这样既能修正磁盘缓存里的旧 minimal 工具面，又保留 WorkBuddy/
 * 历史定义的同名 Agent。
 */
export declare function ensureShippedModeAgents<T extends {
    name?: string;
    tags?: readonly string[];
}>(agents: readonly T[]): T[];
