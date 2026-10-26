import { Logger } from '@celljs/core';
import { type AgentInputItem } from '../../../cbc-shared/node/index.js';
import * as fs from 'fs/promises';
import { LocalJsonlSessionStore } from './local-jsonl-session-store';
import { type Session, SessionFactory, type SessionForkMutationOptions, type SessionForkPointsOptions, type SessionForkPointsPage, type SessionGetOptions, type SessionRewindMutationOptions, SessionStore, type TranscriptPersistenceMetrics } from './session-protocol';
import type { Lane, LanePointer, SessionKey, SessionStoreEntry } from './session-store-contract';
import { SessionImageStorage as ImageBlobService, SessionRestoreHost, SessionStoragePaths, SessionToolOutputStorage as ToolResultBlobService } from './session-store-host-protocol';
/**
 * Read transcript tails in moderately sized blocks. Small files naturally use
 * one read, while large files stop as soon as the requested history window is
 * complete instead of retaining the entire transcript in memory.
 */
export declare const SESSION_REVERSE_READ_CHUNK_BYTES: number;
/**
 * session/load 回放时 history 的默认最大条数。
 * 达到此阈值且遇到 user message 时停止逆序读取，避免启动时全量读 JSONL。
 */
export declare const DEFAULT_SESSION_MAX_ITEMS = 1000;
/**
 * 每追加这么多条 history 行，就把当前 session-meta 快照重新补写到文件尾部。
 *
 * 读侧按 item 数封顶逆序读，只在窗口内找 session-meta；写侧按内容去重，身份
 * 不变就只有创建时那一行（文件第 1 行）。会话一长，读窗口够不到它 → resume
 * 静默丢 `codebuddy.ai/mainAgent`（PTC 掉回 cli、REPL 消失）/ `multitaskMode`
 * / `codebuddy.ai/a2aContexts` / `codebuddy.ai/hostKind`（#128860）。
 *
 * 取值远小于 {@link DEFAULT_SESSION_MAX_ITEMS}，读侧即使把上限调低也仍能覆盖；
 * 代价是每 200 行多一条约 200 字节的行（≈0.1%）。
 *
 * **与 {@link SESSION_META_HEAD_SCAN_BYTES} 是配对约束，必须满足**
 * `SESSION_META_TAIL_REFRESH_LINES × 单行平均字节 << SESSION_META_HEAD_SCAN_BYTES`：
 * 写侧靠本行距把快照压在文件尾部，读侧只有 256KB 的文件头兜底窗口 —— 一旦尾部快照
 * 滑出头部窗口，长会话 resume 丢键（#128860 本体）就会以另一种形式回归。
 * 当前 200 × ~200B ≈ 40KB，对 256KB 有约 6× 余量。**调大本值或让单行显著变长
 * （例如工具结果外置后仍很大的行）都必须同步核对另一侧**，spec 里有一条边界断言钉住。
 */
export declare const SESSION_META_TAIL_REFRESH_LINES = 200;
/** 文件头 session-meta 兜底读取的字节窗口（存量会话用，不做全量回扫）。与上者配对，见其注释。导出以便 spec 钉住配对约束。 */
export declare const SESSION_META_HEAD_SCAN_BYTES: number;
/**
 * 会话标题事实在 session-meta 里的键（#138181）。
 *
 * 标题 item（`custom-title` / `ai-title` / `topic`）只在生成/重命名那一刻写一次，通常在
 * 文件头；history 逆序读封顶 {@link DEFAULT_SESSION_MAX_ITEMS}，长会话 resume 读不到它
 * → 标题服务判为未命名、拿窗口内的中途消息重新生成，覆盖原任务名。
 *
 * 值是 `SessionTitleFact` 数组（session-title-utils）：标题服务判定所依赖的两条事实 ——
 * `hasCustomTitle` 看的最新非空 `custom-title`，`hasGeneratedTitle` 看的最新真实
 * `ai-title`（没有时是 `topic`）。跟着 session-meta 走，就复用了 #128860 的尾部刷新与
 * 文件头兜底，且 session-meta 是 off-tree 行，不进 history、不会被 replay 再发一次。
 * 读侧把窗口里缺的事实合成回 history 最前面，按 history 判标题的调用方无需改动。
 *
 * 标题事实只增不删（空 custom-title 不覆盖更早的非空项，见 `hasCustomTitle`），
 * 所以按键继承、不登记 {@link SNAPSHOT_ONLY_SESSION_META_KEYS}。
 */
export declare const SESSION_TITLE_META_KEY = "codebuddy.ai/sessionTitle";
/**
 * Keys of session.meta that persist across processes (the off-tree
 * session-meta line; bin resume only — served sessions never write). A
 * deliberate whitelist: everything else in session.meta is runtime state and
 * never lands on disk. Literals kept in sync with MAIN_AGENT_META_KEY /
 * MAIN_AGENT_HOST_KIND_KEY (agent/main-agent-session.ts, #97166) and
 * MULTITASK_MODE_META_KEY / DELEGATE_MODE_META_KEY (coordinator overlays) and A2A_CONTEXTS_META_KEY
 * (a2a/a2a-context-store.ts), AGENT_RUNTIME_META_KEY (utils/request-runtime.ts,
 * #144833), plus SESSION_TITLE_META_KEY above (#138181) and
 * PRIVATE_DATA_STICKY_META_KEY above (#127752).
 * activeGoal is owned by GoalService; null is its per-key clear tombstone.
 * The spec asserts the sync. Growing this list is a review decision, not a
 * side effect of putting a key on session.meta.
 * Role / locks / parentSessionId stay runtime-only.
 */
export declare const PERSISTED_SESSION_META_KEYS: readonly ['codebuddy.ai/mainAgent', 'codebuddy.ai/hostKind', 'multitaskMode', 'delegateMode', 'codebuddy.ai/a2aContexts', 'codebuddy.ai/agentRuntime', "codebuddy.ai/sessionTitle", "codebuddy.ai/privateDataSticky", 'activeGoal'];
/**
 * Meta a fork inherits from its source: the persisted whitelist minus title
 * facts, which describe the source conversation and must not label the child
 * (#138181). The command-level fork uses this helper for standing identity,
 * then drops A2A continuation contexts because a remote conversation cannot
 * be branched by copying its local context ID.
 */
export declare function forkInheritedSessionMeta(meta: Session['meta']): Record<string, unknown>;
/**
 * 白名单里「缺席即删除」的键：只认最新那一行的存在性，不向更早的行按键继承。
 *
 * 其余键（mainAgent / hostKind / a2aContexts）只会被赋值、不会被 delete，所以
 * 读侧按键继承——某个写方视野不全（只快照了自己关心的键）不能把别的键擦掉
 * （#128860：`/multitask` 盖章写出只含 multitaskMode 的行，把 PTC 站立身份永久
 * 抹掉，`/agent-mode` 变成 Standard(cli)）。
 *
 * `multitaskMode` / `delegateMode` 会被真正 delete（multitask/session-flags.ts 的
 * clearMultitaskSession / clearDelegateSession），所以必须留在这里，否则"关掉多任务 /
 * 委托"会被更早的 `true` 复活。**新增白名单键时**：只要它的"缺席"承载语义，就必须登记到本表。
 *
 * 注意「缺席」要能写进文件才算数：子集被删空时 `persistSessionMeta` 会补一条
 * `meta: {}` 的墓碑行，否则最新那条仍是删除前的快照，缺席永远不会出现。墓碑是
 * **整份空快照**：为删 A 写的墓碑会连带把表里其他键也判成缺席。两键并存成立的前提是
 * **互斥不变量**：stampDelegateSession 先清 multitaskMode、stampMultitaskSession 先清
 * delegateMode，任一时刻至多一个为 true，所以删其一时另一个本就缺席，空墓碑不会误伤。
 * 再登记不满足该互斥的键时，得改成按键墓碑，别直接往表里加。
 */
export declare const SNAPSHOT_ONLY_SESSION_META_KEYS: ReadonlyArray<string>;
/**
 * 参与合并的一条 session-meta 行。
 *
 * `id` 可能是空串：#94203 才给这行加上自身 UUIDv7，更早写下的存量行没有 id
 * （CHANGELOG 明确「兼容旧的无 ID 记录」）。任何按 id 判等的地方都必须先处理
 * 这个缺失，见 {@link SessionStoreImpl.metaLineIdentity}。
 */
interface SessionMetaLine {
    id: string;
    meta: Record<string, unknown>;
    /** 行原文（trim 后）。缺 id 的存量行靠它做判等。 */
    raw: string;
}
/**
 * 解析 session 历史回放的 maxItems。
 *
 * - 环境变量 `CODEBUDDY_SESSION_MAX_ITEMS` 未设置或为空 → 使用默认值
 * - 环境变量为正整数 → 使用该值（允许线上按需调大，例如 20000）
 * - 环境变量为零/负数/非数字 → 回退到默认值
 */
export declare function resolveSessionMaxItems(envValue?: string | undefined, defaultValue?: number): number;
/**
 * Normalize a work directory for equality checks across Web/TUI clients.
 *
 * Windows paths are case-insensitive and commonly arrive with mixed
 * separators or a trailing separator; comparing their raw strings makes a
 * valid session disappear from a project-scoped history query.
 */
export declare function normalizeComparableCwd(cwd: string | undefined, platform?: NodeJS.Platform): string | undefined;
export declare class SessionStoreImpl implements SessionStore {
    protected readonly logger: Logger;
    protected readonly sessionFactory: SessionFactory;
    protected readonly imageBlobService: ImageBlobService;
    protected readonly toolResultBlobService: ToolResultBlobService;
    protected readonly paths: SessionStoragePaths;
    protected readonly restoreHost: SessionRestoreHost;
    private writeLocks;
    private readonly transcriptMetrics;
    private readonly transcriptAuditOnce;
    private transcriptAuditSequence;
    /**
     * 会话正文取证日志只覆盖低频、可能破坏数据的文件操作。正常 load/append 不走这里，
     * 避免长会话产生大量日志；onceKey 用于同一进程内按 session/path 去重。
     */
    private logTranscriptAudit;
    private nextTranscriptOperationId;
    protected captureTranscriptAuditStack(): string[];
    /** Files whose write lock the current async chain already holds (re-entrancy). */
    private heldFileLocks;
    private withFileWriteLock;
    protected writeJsonlChunk(fileHandle: Awaited<ReturnType<typeof fs.open>>, buffer: Buffer, offset: number): Promise<{
        bytesWritten: number;
    }>;
    protected writeJsonlLine(fileHandle: Awaited<ReturnType<typeof fs.open>>, line: string): Promise<number>;
    protected closeJsonlFile(fileHandle: Awaited<ReturnType<typeof fs.open>>): Promise<void>;
    private cloneHistoryItemForPersistence;
    protected getStorageDir(): string;
    protected getProjectsDir(): string;
    private canonicalizeCwd;
    private getStorageDirFor;
    /**
     * Convert usage from camelCase to snake_case format
     */
    private normalizeUsageFormat;
    /**
     * Transform item data during save
     * - Converts usage data from a.jsonl format (providerData.usage) to b.jsonl format (message.usage)
     * - Normalizes usage field names to snake_case
     * - Externalizes large tool results to disk (>50KB)
     * - Can be overridden for custom transformations
     *
     * @param item The agent input item to transform
     * @param sessionStoreId The session store ID (UUID for main session, "agent-xxxxxx" for subagent)
     * @param parentSessionId Optional parent session ID (for subagents)
     * @param session The live session, used to look up the per-request W3C carrier
     * @param allowSessionRequestFallback When an item has no own conversationRequestId,
     *   attribute it to the session's current request. Correct for the live append path
     *   (the batch belongs to the current turn), but must be OFF for the full-history
     *   rewrite path, where mixed-turn items must never inherit the current turn's carrier.
     */
    protected transformItemForSaveAsync(item: AgentInputItem, sessionStoreId?: string, parentSessionId?: string, session?: Session, allowSessionRequestFallback?: boolean, cwd?: string, externalizeToolResults?: boolean): Promise<any>;
    /**
     * 遍历 item 中的图片数据，将 base64 data URI 替换为 ImageBlobRef
     */
    private replaceImageDataWithBlobRef;
    private toLegacyUserImageRef;
    /**
     * 处理工具调用结果中的图片数据
     */
    private replaceImageInFunctionCallOutput;
    /**
     * Externalize large tool result output to disk.
     * Replaces item.output with a <persisted-output> placeholder containing a preview.
     * This prevents unbounded memory growth in long-running sessions.
     *
     * Handles three output formats:
     * 1. string — plain text output
     * 2. { type: 'text', text: '...' } — SDK-wrapped text output
     * 3. Array<{type:'input_text',text:...}|{type:'input_image',...}|...> — structured output
     *    (only input_text elements are externalized; image/file elements are skipped)
     *
     * Skips output that is already a <persisted-output> placeholder to avoid
     * re-externalizing content recalled via Read tool (which would cause a
     * behavioral loop: externalize → Read → externalize → Read …).
     */
    private externalizeToolResultIfNeeded;
    /**
     * Externalize the UI-only copy of a tool result. Tool implementations commonly store
     * the same payload again in providerData.toolResult.content/renderer; keeping that copy
     * defeats output externalization and can make a single JSONL row hundreds of KiB.
     *
     * The render payload is persisted as one JSON document. History keeps a text renderer
     * pointing at that file, so clients always have a visible fallback instead of trying to
     * parse a <persisted-output> marker as the original media/custom renderer payload.
     */
    private externalizeToolRenderDataIfNeeded;
    /**
     * Handle externalization for structured array output.
     * Iterates through array elements and externalizes any input_text items that exceed the threshold.
     * Non-text elements (input_image, input_file) are left untouched — images are handled
     * separately by the ImageBlobService pipeline.
     */
    private externalizeStructuredArrayOutput;
    protected ensureStorageDir(cwd?: string): Promise<void>;
    /**
     * Get the file path for a session's jsonl history file.
     *
     * For subagents: ~/.codebuddy/projects/{projectId}/{parentSessionId}/subagents/{storeId}.jsonl
     * For main sessions: ~/.codebuddy/projects/{projectId}/{sessionId}.jsonl
     *
     * @param id The session ID or storeId (e.g., session UUID or "agent-xxxxxx")
     * @param parentSessionId Optional parent session ID (for subagents)
     */
    getSessionFilePath(id: string, parentSessionId?: string, cwd?: string): string;
    /**
     * Get the file path for a session's metadata file.
     *
     * For subagents: ~/.codebuddy/projects/{projectId}/{parentSessionId}/subagents/{storeId}.meta.json
     * For main sessions: ~/.codebuddy/projects/{projectId}/{sessionId}.meta.json
     */
    getSessionMetaFilePath(id: string, parentSessionId?: string, cwd?: string): string;
    private lastPersistedMeta;
    /** 各转录文件「距上次 session-meta 行」的 history 行数（进程内，用于尾部刷新节流）。 */
    private historyLinesSinceMeta;
    /** 读侧靠文件头兜底才拿到 meta 的转录文件：下一批 append 立即把快照补到尾部。 */
    private staleTailMeta;
    /**
     * 「据已知，该转录尾部最新那条 session-meta 还带着非空子集」——决定子集被删空时
     * 要不要补墓碑。
     *
     * 判据必须是**文件事实**而不是"本进程写过什么"：resume 只 `get()` 不 `save()`
     * （agent-task.ts 的子代理恢复就是这样），进程内缓存恒空，冷启动后第一轮就关掉
     * 多任务会写不出墓碑，"关掉"永远落不了盘。所以读侧 load 完也要维护它。
     *
     * 仍是进程内状态：同一转录被两个进程同时写时，另一方的非空写入本进程不可见
     * （与 `lastPersistedMeta` 同一层限制）。
     */
    private tailMetaNonEmpty;
    private persistedMetaSubset;
    /** 一条 off-tree session-meta 行的字节形式。空 `persisted` 即墓碑快照。 */
    private metaSnapshotLine;
    /** The off-tree session-meta line, or undefined when there is nothing to persist. */
    protected sessionMetaLineFor(fileId: string, meta: Session['meta']): string | undefined;
    /**
     * Session-meta persistence: an off-tree snapshot line appended INTO the
     * transcript jsonl itself — carries its own id and sessionId, no parentId (never
     * enters the tree), latest wins on read; appended only when the
     * whitelisted subset actually changed. Replaces the retired whole-file
     * .meta.json overwrite. Bin surface only — served sessions never reach
     * here (persistence gate; locked by spec).
     */
    protected persistSessionMeta(fileId: string, meta: Session['meta'], parentSessionId?: string, cwd?: string, options?: {
        force?: boolean;
    }): Promise<void>;
    /**
     * 尾部快照刚落盘后的进程内状态收尾 —— 四份状态必须一起动。
     *
     * `lastPersistedMeta` / `historyLinesSinceMeta` / `staleTailMeta` / `tailMetaNonEmpty`
     * 都以 filePath 为键、都描述「这个转录尾部最新那条 meta 现在是什么」。任何往尾部
     * 写快照的路径（persistSessionMeta / initializeForkHistory）都要走这里：在调用点
     * 手写四行，下一次再加状态时必然漏一处 —— fork 初始化就是这么漏的（lastPersistedMeta
     * 写了，另外三份没写，导致 fork 后关掉多任务写不出墓碑、行数计数带着旧值）。
     */
    private markTailMetaPersisted;
    /**
     * 读侧发现尾部快照不全（事实只能从文件头 / 窗口外拼回来）：标记过期并把计数播种成
     * 阈值，下一批 append 立即补一条完整快照。冷启动 resume 的进程内计数从 0 开始，
     * 若不播种、本次又没补写就重启，长会话会长期不刷新尾部 meta。
     */
    private markTailMetaStale;
    /**
     * 让「最新 session-meta」始终留在读侧的逆序窗口内（#128860 根治的写入侧）。
     *
     * 只在 history 真正落盘之后调用：每 {@link SESSION_META_TAIL_REFRESH_LINES}
     * 行补写一次快照；读侧走过文件头兜底的文件（存量长会话）立即补写一次，
     * 这样同一个会话只会退化一次。
     *
     * 失败不能拖垮本轮 append —— 转录字节已经写成功了，meta 下一批还会重试。
     */
    private refreshTailSessionMeta;
    /**
     * 把本批追加的标题 item 并进 `session.meta` 的标题事实（#138181 的写入侧）。
     *
     * 增量合并「已知事实 + 本批标题」：标题只在生成/重命名时出现，其余批次直接跳过，
     * 不回扫 history。meta 里还没有这个键（经别的加载路径拿到的 session）时才从内存
     * history 起底一次。落盘交给紧随其后的 {@link refreshTailSessionMeta}：行距内
     * 原始标题 item 本身就在尾部窗口里，之后每 {@link SESSION_META_TAIL_REFRESH_LINES}
     * 行的快照都带着这份事实 —— session-meta 是 off-tree 行，补写不受同 id 响应组约束。
     */
    private trackSessionTitleFacts;
    /**
     * 文件头的 off-tree 事实兜底读取：session-meta 行与标题 item。
     *
     * `session-meta` 创建行通常在文件靠前的位置（新建会话是第 1 行；子会话/迁移过的
     * 会话可能更靠后），而 history 逆序读有 item 上限——长会话倒着读到不了那里
     * （#128860）。首轮的 `ai-title` 同理，落盘在文件头几行（#138181）。这里只读文件头
     * 一小段，不做全量回扫：
     * 29MB 的会话里末尾 1100 行只占 20% 字节，回扫到头会把 resume 的读 I/O 放大 5×。
     *
     * 返回窗口内所有 session-meta 的 meta（文件序，旧→新），由
     * {@link composeSessionMeta} 统一合并；标题时间线（标题 item 与快照里的标题键混排）
     * 同为文件序，由 {@link resolveSessionTitleFacts} 折叠。
     */
    protected readHeadOffTreeFacts(filePath: string): Promise<{
        metaLines: SessionMetaLine[];
        titleTimeline: AgentInputItem[];
    } | undefined>;
    /**
     * 合并去重用的行身份。
     *
     * 不能直接用 `id`：#94203 之前的存量行没有 id，兜成空串会让「头部的创建行」
     * 和「尾部的残缺行」撞成同一个键 —— 头部那条被当成"已经见过"丢掉，正好复现
     * 本 issue 要修的丢键现场（本机实测 2607 条 meta 行里 1195 条没有 id）。
     * 缺 id 时退回整行原文：内容相同的两行参与合并是幂等的，丢一条无害。
     */
    private metaLineIdentity;
    /**
     * 把若干条 session-meta（文件序，旧→新）合成一份 meta 事实。
     *
     * - {@link SNAPSHOT_ONLY_SESSION_META_KEYS}：只认最新那一行（缺席=已删除）。
     * - 其余白名单键：按键向更早的行继承，最新的值优先。写方只快照了自己视野
     *   里的键时，别人的键不会被顺带擦掉（#128860 的第二处：`/multitask` 写出
     *   只含 multitaskMode 的行，PTC 站立身份被永久抹掉）。
     */
    protected composeSessionMeta(metaLinesOldestFirst: ReadonlyArray<SessionMetaLine>): Record<string, unknown> | undefined;
    private findSubagentSessionByStoreId;
    protected deserializeSessionFromJsonl(id: string, options?: SessionGetOptions): Promise<Session | undefined>;
    /**
     * 从指定路径反序列化 session（供 getAllAcrossProjects 复用）
     */
    protected deserializeSessionFromPath(filePath: string, options?: SessionGetOptions): Promise<Session | undefined>;
    protected getSessionId(filePath: string): string;
    protected readLatestGoalState(filePath: string, fileSize: number): Promise<unknown>;
    private applyNewerGoalHistory;
    private isLegacyGoalStateChange;
    /**
     * Read complete UTF-8 JSONL records from newest to oldest with bounded I/O.
     * Newline bytes are safe boundaries in UTF-8; a record is decoded only
     * after all of its cross-chunk Buffer fragments have been assembled.
     */
    protected readLinesFromEnd(filePath: string, fileSize: number, consumeLine: (line: string) => boolean): Promise<number>;
    private decodeReverseLine;
    private getPreferredProjectDirs;
    get(id: string, options?: SessionGetOptions): Promise<Session | undefined>;
    getAcrossProjects(id: string, options?: SessionGetOptions): Promise<Session | undefined>;
    getMostRecent(): Promise<Session | undefined>;
    save(session: Session, cwdOrOptions?: string | {
        cwd?: string;
        skipMeta?: boolean;
    }): Promise<void>;
    remove(id: string, parentSessionId?: string): Promise<void>;
    /**
     * Delete every durable copy of a public root session.
     *
     * A root created by session/fork is a separate catalog entry and is never
     * traversed here. Descendants below refer only to private Agent-tool
     * Subagent storage owned by the deleted root.
     *
     * The root JSONL is an opaque catalog artifact. Private Agent-tool
     * descendants are discovered from owned `subagents/` directories using
     * legacy identity sidecars or the first usable identity in each child
     * JSONL, without full-history or duplicate-item validation;
     * then their runtime-owned directories are removed deepest-first. Each root
     * JSONL is atomically renamed to a non-catalog tombstone before cleanup; the
     * tombstone is removed last so interrupted deletion remains retryable.
     */
    removeAcrossProjects(id: string): Promise<void>;
    private getCatalogTargetNames;
    private findCatalogSessionFiles;
    private listCatalogProjectIdentities;
    private listCatalogProjectDirectories;
    private assertCatalogProjectUnchanged;
    private assertRegularCatalogFile;
    protected unlinkCatalogFile(filePath: string): Promise<void>;
    protected renameCatalogFile(sourcePath: string, targetPath: string): Promise<void>;
    protected removeCatalogDirectory(directory: string): Promise<void>;
    private prepareDurableSessionDeletePlan;
    private collectDurableDeleteGraph;
    private tryReadDurableDeleteSubagentIdentity;
    private assertDurableDeleteChildMetaLineage;
    private hasCatalogRootArtifact;
    private executeDurableSessionDeletePlan;
    private assertDeleteFileSnapshotUnchanged;
    private assertDeleteOptionalRegularFile;
    private assertDeleteSafeTreeIfPresent;
    private assertDeleteOptionalSafeDirectory;
    private removeDeleteFileIfPresent;
    private removeDeletePreparedTreeIfPresent;
    private isMissingPathError;
    getAll(): Promise<Session[]>;
    getAllAcrossProjects(options?: {
        sinceMs?: number;
    }): Promise<Session[]>;
    getAllByWorkdir(cwd?: string | null, options?: {
        sinceMs?: number;
    }): Promise<Session[]>;
    /**
     * Extract cwd from a session by finding the first history item with cwd field
     */
    private extractCwdFromSession;
    /** Bind only after finding or creating the file in the selected workspace. */
    private bindRequestedSessionCwd;
    /**
     * Filter out non-user sessions:
     * - Sub-agent sessions (Agent tool spawned agents like Explore, Plan, etc.)
     * - Compact fork sessions (temporary sessions created for async compaction)
     */
    protected isNonUserSession(session: Session): boolean;
    appendHistory(id: string, input: AgentInputItem[], parentSessionId?: string, session?: Session, cwd?: string, options?: {
        required?: boolean;
    }): Promise<void>;
    /**
     * 每个转录文件最后一条已落盘快照的身份（#139610）。只在追加成功后更新；本进程没写过
     * （刚启动 / resume）时下一条快照照常落盘。
     */
    private lastPersistedSnapshot;
    /** 扫描整个文件里的快照行，返回展开后的完整表（基表落在尾部读取窗口之外时兜底）。 */
    private readPersistedSnapshotTables;
    private dropRepeatedSnapshots;
    protected openJsonlFile(filePath: string, flags: string): ReturnType<typeof fs.open>;
    /** Short, in-band only: this runs on the addHistory chain, so it is turn latency. */
    protected transcriptRetryDelaysMs(): readonly number[];
    protected sleepBeforeTranscriptRetry(delayMs: number): Promise<void>;
    /** Cumulative transcript persistence counters (issue #119545 埋点). */
    transcriptPersistenceMetrics(): Readonly<TranscriptPersistenceMetrics>;
    /**
     * The transcript-line writer: exclusive-create or append open, chunked line
     * writes, and on failure a rollback (unlink a file this batch created,
     * truncate to the original size otherwise) with forensic audit logs.
     *
     * A retryable failure gets a short in-band retry. When the budget runs out
     * the batch is abandoned and reported as a typed error — the local copy is
     * allowed to lose its tail, and `addHistory` keeps the turn running. Read
     * paths repair the gap (unpaired tool calls are filtered out of model
     * input), so the cost of a loss is a shorter history, not a broken one.
     */
    protected writeTranscriptLines(sessionFilePath: string, lines: string[], key?: SessionKey): Promise<void>;
    private writeTranscriptLinesOnce;
    private readonly entriesStoreInstances;
    /**
     * The embedded SessionStore-contract backend — the single jsonl writer
     * (design: docs/cloud-native/session-store-v2-spi.md, "后端实现").
     * assignParentIds: false — the kernel's linkage processor has already
     * assigned parentId (absence there MEANS segment root); the store only
     * advances the lane tip and never touches the payload.
     */
    protected get entriesStore(): LocalJsonlSessionStore;
    private entriesStoreFor;
    /**
     * The SessionKey for a kernel (fileId, parentSessionId) address. The
     * projectKey override serves the host-store route — the server surface
     * binds it per session so host keys stay byte-identical to the mirror
     * era's; the local backend derives its own from the storage dir.
     */
    sessionKeyFor(id: string, parentSessionId?: string, projectKey?: string): SessionKey;
    listLanes(key: SessionKey): Promise<LanePointer[]>;
    getLane(key: SessionKey, lane?: Lane): Promise<string | null>;
    moveLane(key: SessionKey, lane: Lane, to: string | null): Promise<void>;
    loadLane(key: SessionKey, lane?: Lane): Promise<SessionStoreEntry[]>;
    appendFactAndMoveLane(key: SessionKey, entries: SessionStoreEntry[], lane: Lane, to: string | null, options?: {
        persistLocal?: boolean;
    }): Promise<void>;
    initializeForkHistory(session: Session): Promise<void>;
    saveHistory(session: Session, cwd?: string): Promise<void>;
    listForkPoints(source: Session, options: SessionForkPointsOptions): Promise<SessionForkPointsPage>;
    forkSession(source: Session, options: SessionForkMutationOptions): Promise<Session>;
    private forkSessionWithSubagentGraph;
    private createForkSubagentGraphBudget;
    private loadForkRootConversationHistory;
    private assertForkRootHistoryPrefix;
    private collectForkSubagentGraph;
    private loadForkSubagentSession;
    private addForkSourceBytes;
    private readForkStrictHistorySnapshot;
    private readDurableSubagentMeta;
    /**
     * Graph cloning needs a canonical, fail-closed view of every referenced
     * child. Keep this separate from deserializeSessionFromPath: the latter is
     * deliberately tolerant because legacy replay must continue past damaged
     * lines and optional/old metadata.
     */
    private deserializeForkSubagentSession;
    private assertForkGraphAcyclic;
    private resolveForkChildPrefixEnd;
    private readForkRuntimeSessionId;
    private assertForkChildMetaLineage;
    private readForkSubagentLink;
    private assertForkLifecycleLineage;
    private createForkHistoryIdMap;
    private assertForkHistoryIdsUnique;
    private cloneForkHistory;
    private replaceForkStringReferences;
    private mapForkBoundaryId;
    private remapForkLifecycle;
    private resolveForkTargetParent;
    private cloneForkSubagentMeta;
    private findForkLastMessageId;
    private isForkRecord;
    private getForkSubagentToolResultDir;
    private planForkToolResultCopies;
    private collectForkPersistedOutputPaths;
    private readForkPersistedOutputPath;
    private rewriteForkPersistedOutputPaths;
    private assertForkOpaquePathSegment;
    private assertForkSubagentStoreId;
    private resolveForkProjectDirectory;
    private assertForkSafeDirectory;
    private assertForkSafeRegularFile;
    private rethrowForkMissingArtifact;
    private requireForkContainedRelativePath;
    private assertForkRealPathContained;
    private assertForkPathHasNoSymlink;
    private copyForkToolResults;
    private commitForkSession;
    private cleanupFailedForkGraph;
    private cleanupFailedFork;
    rewindSession(source: Session, options: SessionRewindMutationOptions): Promise<void>;
}
export {};
//# sourceMappingURL=session-store.d.ts.map