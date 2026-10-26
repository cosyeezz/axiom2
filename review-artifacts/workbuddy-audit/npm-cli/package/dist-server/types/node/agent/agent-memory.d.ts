/**
 * Agent persistent memory — Claude Code parity.
 *
 * An agent definition may declare `memory: user | project | local`. When auto
 * memory is enabled, the subagent gets:
 * - a scope-specific memory directory (created on first use),
 * - a "Persistent Agent Memory" section appended to its system prompt with the
 *   current MEMORY.md content (truncated to 200 lines / 25KB).
 *
 * 对齐 Claude Code：memory 启用时除注入提示段落外，若 agent 显式声明了 tools
 * 白名单，还会自动补 Read/Write/Edit（CC loadAgentsDir.ts:662-674），保证 agent
 * 能读写 MEMORY.md；tools 缺省（继承默认工具集）时不改动。注入逻辑见
 * agent-manager.ts registerAgent。
 *
 * Directory layout (mirrors Claude Code's ~/.claude → ~/.codebuddy mapping):
 * - user:    <configDir>/agent-memory/<agentType>/            (shared across projects)
 * - project: <cwd>/.codebuddy/agent-memory/<agentType>/       (checked into the repo)
 * - local:   <cwd>/.codebuddy/agent-memory-local/<agentType>/ (per-project, not for VCS)
 *
 * Out of scope (deliberate): Claude Code's feature-flagged project→user snapshot
 * initialization; genie has no remote-memory host equivalent either.
 */
export type AgentMemoryScope = 'user' | 'project' | 'local';
export declare const AGENT_MEMORY_SCOPES: readonly AgentMemoryScope[];
/** Entry file read into the prompt; topic files live beside it. */
export declare const MEMORY_ENTRYPOINT_NAME = "MEMORY.md";
/** MEMORY.md truncation caps (Claude Code values). */
export declare const MAX_MEMORY_ENTRYPOINT_LINES = 200;
export declare const MAX_MEMORY_ENTRYPOINT_BYTES = 25000;
/** Kill-switch: truthy disables agent memory entirely. Default: enabled. */
export declare const ENV_DISABLE_AUTO_MEMORY = "CODEBUDDY_CODE_DISABLE_AUTO_MEMORY";
export declare function isAutoMemoryEnabled(): boolean;
export declare function normalizeAgentMemoryScope(value: unknown): AgentMemoryScope | undefined;
/**
 * Flatten an agent type into a single path segment.
 * - `:` (plugin scoped name separator) → `-`
 * - `/` and `\` → `-` so a malicious/typo'd frontmatter `name` cannot escape
 *   the memory root via `../` or absolute-looking segments
 * - empty / `.` / `..` after sanitization → `_` (never a traversable segment)
 */
export declare function sanitizeAgentTypeForPath(agentType: string): string;
export declare function getAgentMemoryDir(agentType: string, scope: AgentMemoryScope): string;
export interface TruncatedMemory {
    text: string;
    /** Which cap fired, if any. */
    truncatedBy?: 'lines' | 'bytes';
}
/**
 * Truncate MEMORY.md content: first 200 lines, then a 25KB byte cap cut at the
 * last newline before the limit (hard cut when the text has no newline). A
 * warning naming the cap is appended so the agent knows the index is partial.
 */
export declare function truncateMemoryEntrypoint(content: string): TruncatedMemory;
/**
 * Build the "Persistent Agent Memory" system-prompt section for an agent.
 * Ensures the memory directory exists, then embeds the (truncated) MEMORY.md.
 * Evaluated lazily at agent-instructions time, so each spawn sees fresh memory.
 */
export declare function buildAgentMemoryPrompt(agentType: string, scope: AgentMemoryScope): Promise<string>;
export declare const MEMORY_SNAPSHOT_DIR_NAME = "agent-memory-snapshots";
export declare const SNAPSHOT_METADATA_NAME = "snapshot.json";
export declare const SNAPSHOT_SYNC_MARKER_NAME = ".snapshot-synced.json";
export declare function getAgentMemorySnapshotDir(agentType: string, workDir?: string): string;
export type SnapshotInitResult = 'initialized' | 'pending-update' | 'none';
/**
 * Seed a user-scope agent's memory from the project snapshot when the memory
 * dir has no markdown yet, mirroring Claude Code's snapshot initialization.
 * Idempotent: the `.snapshot-synced.json` marker plus existing `*.md` files
 * prevent re-copying; a newer snapshot yields 'pending-update' without
 * overwriting the agent's accumulated memory.
 */
export declare function initializeMemoryFromSnapshotIfNeeded(agentType: string, scope: AgentMemoryScope, workDir?: string): Promise<SnapshotInitResult>;
