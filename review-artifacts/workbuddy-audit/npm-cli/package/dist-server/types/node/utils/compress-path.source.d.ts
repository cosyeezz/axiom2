/**
 * 工作空间路径归一算法 —— 全仓库唯一手写真源（Single Source of Truth）。
 *
 * 把一条绝对 `cwd` 归一成一个可作为**单段目录名**的字符串，用于
 * `<configDir>/projects/<name>/<conversationId>.jsonl` 的 `<name>`。
 *
 * ⚠️ 这段逻辑在多个隔离边界（agent-cli 独立产品 / workbuddy-core /
 * workbuddy-server / edge-sync extension / history-migration）都要用到，且
 * **读侧必须与写侧字节一致**，否则读端找不到写端落盘的目录。由于 agent-cli
 * 禁止依赖 workbuddy，无法用「一个共享包被所有人 import」根治。
 *
 * 已知保留独立手写副本、未接入本真源的边界（≤255B 时与真源字节一致；算法变更
 * 需人工同步，不随 CI --check 守卫）：lamp-agent-pool 服务、sandbox-proxy Go 侧。
 *
 * 因此本文件是**唯一手写实现**，由 `scripts/generate-compress-path.mjs` 读取本
 * 文件、生成 `compress-path.generated.ts` 分发到各消费方（仿
 * `services/scripts/generate-lamp-error-codes.mjs`）。CI 用 `--check` 守卫漂移。
 *
 * 【修改须知】改这段算法**只改本文件**，然后跑
 * `node scripts/generate-compress-path.mjs` 重新生成所有下游副本。
 *
 * 【实现约束】
 * - 纯函数、零外部依赖（只用 `Buffer`，Node/Bun 都有），可被逐字节复制到任何目标。
 * - hash 用 djb2→base36（对 UTF-8 字节做 hash，跨 runtime/进程稳定）；
 *   **禁止** `Bun.hash`/`crypto`（跨 runtime 结果不一致，会导致读写错位）。
 * - 阈值 255 字节：APFS/ext4/NTFS 单段文件名上限 NAME_MAX=255B。存量 ≤255B 的
 *   目录走原算法**零漂移**；仅超限时才截断+hash。
 * - 截断按 UTF-8 码点边界，避免把多字节字符（如中文 3B/码点）切成半个坏字节。
 */
/** 单段目录名字节上限（APFS/ext4/NTFS NAME_MAX）。 */
export declare const WORKSPACE_PATH_NAME_MAX_BYTES = 255;
/** 超限时截断前缀保留的最大字节数；给 `-` + hash 后缀留足空间。 */
export declare const WORKSPACE_PATH_PREFIX_MAX_BYTES = 180;
/**
 * djb2 哈希（对 UTF-8 字节），输出 base36。与 web-ui mcp-app-handlers 的 djb2
 * 同构，但这里对**字节**而非 UTF-16 char code 取 hash，保证跨编码/跨 runtime 稳定。
 */
export declare function djb2Base36(input: string): string;
/**
 * 把字符串按 UTF-8 字节数截断到 `maxBytes`，且不切坏任何码点。
 * 逐码点累加字节长度，超过上限即停。
 */
export declare function truncateToByteLimitOnCodePoint(value: string, maxBytes: number): string;
/**
 * 路径归一为「基础串」（未做长度守卫）：`/` `\` `:` → `-`，去首尾 `-`，
 * 连续 `-` 折叠。`compressWorkspacePathName` 与读侧 legacy 兜底共用，
 * 避免归一逻辑在写侧/读侧各存一份副本导致算法漂移（见
 * workbuddy-core 的 `tryResolveLegacyProjectDirByPrefix`）。
 */
export declare function normalizeWorkspacePathBase(dir: string): string;
/**
 * 把任意目录路径归一成一个安全的单段目录名。
 *
 * 例：'/Users/ericffan/my-project' → 'Users-ericffan-my-project'
 *
 * 超长（>255 字节）时：截断前缀（≤180B，码点边界）+ '-' + djb2Base36(完整归一串)，
 * 总长 ≤ 180 + 1 + ~7 < 255B，且对同一输入稳定、可被读侧前缀扫描定位。
 */
export declare function compressWorkspacePathName(dir: string): string;
