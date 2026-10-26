/**
 * Checkpoint 协议（读侧）—— 对齐 ACP v2 Diff 规范。
 *
 * 该协议由 agent-cli 的 checkpoint feature 定义，供上层调用方（例如 WorkBuddy Server）使用。
 * 按 checkpoint 读写对偶划分：
 *
 * | 语义 | 方法 | 副作用 |
 * |---|---|---|
 * | 列 checkpoint | `_codebuddy.ai/checkpoint/list` | 无，纯只读 |
 * | 读 checkpoint | `_codebuddy.ai/checkpoint/read` | 无，纯只读 |
 * | 写 checkpoint | `_codebuddy.ai/session/rollback`（带 `files`） | 文件 + 会话指针 + 墓碑 |
 *
 * 写侧不在此处定义：它属于会话回退协议（`acp-view-rollback.ts`），由新旧架构共用。
 *
 * 本协议只描述“消息轮次”和“文件最终变化”，不会暴露 Sandbox 的 `commitSeq`、
 * 备份文件名等底层实现细节。消息与 Sandbox 提交之间的关联、多个提交的恢复顺序、
 * 同一路径结果的合并，都由 agent-cli 内部负责。
 *
 * @see https://agentclientprotocol.com/protocol/v2/tool-calls#diffs
 */
/**
 * agent-cli 对外暴露的 checkpoint 扩展方法名。
 *
 * 命名按 checkpoint 语义域 + 动作分层（`checkpoint/<verb>`），使「哪些操作会改状态」
 * 在协议面一眼可判：`list` / `read` 纯只读，可任意重复调用；写走 `session/rollback`。
 *
 * 写侧之所以不叫 `checkpoint/write`：旧架构（MainContentCore）与 4 个 adapter 共 8 个
 * 消费点在用 `session/rollback` 这个 wire 名，改名即断链。因此写侧**保留字面量、
 * 只在语义上归入 checkpoint 写**。这个不对称是刻意的，代价是「写侧名字读不出
 * checkpoint」，换来的是零破坏。
 */
export declare const CHECKPOINT_METHODS: {
    /**
     * 列出当前会话可回退的 checkpoint 概要，不修改任何状态。
     *
     * **当前只有 agent-cli 侧实现，core / agent-ui 不消费**：WorkBuddy 的交互是
     * 「点某条消息 → 回退」，没有 checkpoint 列表界面。刻意不在 core 补
     * `ConversationAcpMethod` 常量与 controller 方法 —— 那会形成一条没有消费者的
     * 死链路，让后来者以为端到端已通。
     *
     * 保留该方法是因为它对**外部 ACP 调用方**（非 WorkBuddy UI）本身就是完整能力：
     * 协议已就绪，将来产品要做列表入口时按 `READ` 的三层贯通方式接上即可。
     */
    readonly LIST: "_codebuddy.ai/checkpoint/list";
    /** 读一个 checkpoint 的完整内容（ACP diff + 补充信息），不修改任何状态。 */
    readonly READ: "_codebuddy.ai/checkpoint/read";
};
/**
 * 文件回退请求可能返回的稳定业务错误码。
 *
 * 错误码通过 ACP JSON-RPC error 的 `data.code` 返回。调用方只应根据 `code`
 * 分支处理，不能依赖错误文案：
 *
 * - `FILE_ROLLBACK_SESSION_BUSY`：会话仍在生成或执行工具，稍后重试；
 * - `FILE_ROLLBACK_SANDBOX_UNAVAILABLE`：当前会话没有可用的 Sandbox；
 * - `FILE_ROLLBACK_TARGET_NOT_FOUND`：目标 checkpoint 不在当前有效会话分支；
 * - `FILE_ROLLBACK_METADATA_UNAVAILABLE`：旧会话缺少 request 与备份提交的关联；
 * - `FILE_ROLLBACK_COMMIT_GC`：回退范围内至少一个整轮提交已经被 Sandbox GC，
 *   为避免只回退半轮文件，agent-cli 拒绝执行整个文件回退。
 * - `FILE_ROLLBACK_RESTORE_FAILED`：文件恢复过程中至少一个文件失败，
 *   agent-cli 已尝试把文件复原到操作前状态。
 */
export declare const FileRollbackErrorCode: {
    readonly SESSION_BUSY: "FILE_ROLLBACK_SESSION_BUSY";
    readonly SANDBOX_UNAVAILABLE: "FILE_ROLLBACK_SANDBOX_UNAVAILABLE";
    readonly TARGET_NOT_FOUND: "FILE_ROLLBACK_TARGET_NOT_FOUND";
    readonly METADATA_UNAVAILABLE: "FILE_ROLLBACK_METADATA_UNAVAILABLE";
    readonly COMMIT_GC: "FILE_ROLLBACK_COMMIT_GC";
    /** 文件恢复过程中至少一个文件失败，agent-cli 已尝试把文件复原到操作前状态。 */
    readonly RESTORE_FAILED: "FILE_ROLLBACK_RESTORE_FAILED";
};
export type FileRollbackErrorCode = typeof FileRollbackErrorCode[keyof typeof FileRollbackErrorCode];
/**
 * ACP v2 `DiffChange.operation` 的五种标准值。
 *
 * ⚠️ **agent-cli 只会产出 `add` / `delete` / `modify` 三种**。
 *
 * `move` / `copy` 永不产出，原因是数据源不支持而非未实现：Sandbox 备份条目
 * （`ModifyBackupFileEntry`）的 `reason` 只有 `BackupReason = 'a' | 'm' | 'd'`
 * 三种，备份层不透出重命名关系（`FileOp` 虽有 `rename`，但不进备份元数据）。
 * 一次重命名在备份里最多表现为「新路径 a + 旧路径 d」两条独立记录，
 * agent-cli 无从判定二者同源。
 *
 * 保留完整的五值联合是为了让类型与 ACP 规范同构（调用方按规范写 switch 时
 * 类型检查不会漏分支），不代表我们会产出后两种。
 */
export type CheckpointDiffOperation = 'add' | 'delete' | 'modify' | 'move' | 'copy';
/** ACP v2 `DiffChange.fileType` 的合法取值。 */
export type CheckpointFileType = 'text' | 'binary' | 'directory' | 'symlink';
/**
 * ACP v2 `DiffChange` —— 单个文件的结构化变更。
 *
 * **方向语义**：始终描述「当前 workspace → checkpoint 状态」需要执行的操作，
 * 也就是**回退方向**，而不是 agent 当初做了什么。两者恰好相反：
 *
 * | agent 当初做了什么（`BackupReason`） | 回退需要做 | `operation` |
 * |---|---|---|
 * | 新建文件（`'a'`） | 删掉它 | `delete` |
 * | 修改文件（`'m'`） | 原地恢复内容 | `modify` |
 * | 删除文件（`'d'`） | 重新创建 | `add` |
 *
 * 最后一行是本次对齐 ACP 时修正的语义失真：改造前 `'d'` 与 `'m'` 一同被归为
 * `action: 'restore'`，上报成「内容需要恢复」，而它实际上是「文件需要重新创建」。
 */
export interface CheckpointDiffChange {
    /** 从当前 workspace 回退到 checkpoint 所需执行的操作。 */
    operation: CheckpointDiffOperation;
    /**
     * **操作之后**的绝对路径（规范原文：the absolute path after the operation）。
     *
     * 标准化后的绝对文件系统路径，不是 `file://` URI，也不是 WorkBuddy 的 artifactId。
     * agent-cli 按规范化后的路径去重，保证同一个文件在一次响应中只出现一次。
     */
    path: string;
    /**
     * **操作之前**的绝对路径。ACP 规范中仅 `move` / `copy` 必需。
     *
     * agent-cli 不产出这两种 operation，因此该字段恒为 undefined；
     * 保留声明是为了与规范同构。
     */
    oldPath?: string;
    /**
     * 文件种类。ACP 规范中为**可选**，未提供时由 Client 自行推断。
     *
     * agent-cli 当前不下发：手上只有 `realPath`，判定种类需要额外 stat —— 那会给
     * 纯只读路径引入 IO；而 `add`（回退时才重新创建，当前并不存在）根本 stat 不到，
     * 强行补会得到「有的有、有的没有」的不一致结果。
     */
    fileType?: CheckpointFileType;
    /** 文件内容的 MIME 类型。ACP 可选字段，理由同 `fileType`，当前不下发。 */
    mimeType?: string;
}
/**
 * ACP v2 `DiffPatch` —— 可渲染的补丁文本。
 *
 * `format` 目前规范只定义了 `git_patch`：由一个或多个 `diff --git` 段组成、
 * 路径必须为绝对路径、不得包含 commit 元数据与邮件信封。
 */
export interface CheckpointDiffPatch {
    format: 'git_patch';
    text: string;
}
/**
 * ACP v2 `Diff` 载荷。
 *
 * 规范约束：`changes` 是**权威来源**（受影响路径与操作类型以它为准）；
 * `patch` 只是可选的可渲染文本，存在时必须与 `changes` 一致。
 * **调用方必须能处理 `patch` 缺失**。
 *
 * agent-cli 当前不生成 `patch`：备份体系存的是整份文件快照而非行级差异，
 * 要产出 git patch 需读取「快照内容 + 当前内容」并做逐文件 diff，
 * 属于只读路径上的重 IO。留字段是为了将来按需补齐时不必改协议形状。
 */
export interface CheckpointDiff {
    changes: CheckpointDiffChange[];
    patch?: CheckpointDiffPatch;
}
/**
 * 在回退范围内、但**无法**恢复的文件。
 *
 * 为什么不塞进 `diff.changes`：ACP 的五种 operation 描述的都是**真实会发生的变更**，
 * 而这类文件的结局恰恰是「什么都不会发生，保持当前内容」——它按定义不是一个 change，
 * 塞进去会让 `changes` 对调用方说谎（宣称要改却不会改）。
 *
 * 但它也不能丢：UI 必须据此告知用户「这一轮不是全都退得回来」，否则用户会以为
 * 整轮已完整回退。因此作为 `diff` 的兄弟字段并列返回。
 */
export interface CheckpointUnavailableFile {
    /** 标准化后的绝对文件系统路径。 */
    path: string;
    /**
     * 无法回退的原因。
     *
     * `version_unavailable`：agent-cli 知道该文件属于回退范围，但准确版本及可作为
     * fallback 的后续版本都已不存在（例如对应 Sandbox 快照已被 GC）。
     * 这是**预期的降级结果**，不等同于执行阶段发生 I/O 错误。
     */
    reason: 'version_unavailable';
}
/**
 * `modify` / `add` 类变更的版本补充信息。
 *
 * 为什么不塞进 `diff.changes`：ACP 的 `DiffChange` 只表达「做什么操作」，
 * 没有「恢复到哪个时间点的版本」这一维度。而 UI 需要它来渲染版本时间，
 * 并在只能恢复到更晚版本时给出警告。
 *
 * 通过 `path` 与 `diff.changes` 关联（同一响应内路径唯一）。
 * `delete` 类变更不会出现在这里——删除不需要版本。
 */
export interface CheckpointRestoreInfo {
    /** 与 `diff.changes[].path` 对应的标准化绝对路径。 */
    path: string;
    /**
     * 实际能够恢复到的版本位置：
     *
     * - `exact`：能准确恢复到目标 checkpoint 之前的文件版本；
     * - `fallback`：准确版本已不存在，只能恢复到该 checkpoint 之后最早仍可用的版本。
     *
     * `fallback` **不是执行失败**。它表示可以回退，但最终内容会比目标时间点更新，
     * 上层应在确认面板中明确提示用户。
     */
    restorePoint: 'exact' | 'fallback';
    /**
     * 实际采用的文件快照所属 request ID。
     *
     * Sandbox 在该 request 修改文件之前创建快照，因此该字段标识的是「此 request
     * 开始前」的文件版本。`fallback` 时它可能晚于请求定位到的 checkpoint；
     * 上层可用该 ID 查询对应消息时间，展示实际能够回退到的版本时间。
     */
    versionRequestId: string;
}
/**
 * checkpoint 定位参数（读侧共用）。
 *
 * **双键并存**：`messageId` 与 `requestId` 至少提供一个，同时提供时按
 * 「messageId 优先、requestId 兜底」解析——这是两次独立的命中机会，与写侧
 * `session/rollback` 的双键语义一致。
 *
 * 之所以不只收 `messageId`：core 侧的 `forkMessageId` 曾被填入 request 级 traceId
 * 这种必然解析失败的伪值（#90726），单键会让「读不到 checkpoint」重新变成
 * 一条静默失败路径。保留 `requestId` 作为第二条路。
 *
 * 回退边界采用左闭区间：撤销该 checkpoint 对应请求及其之后、当前有效会话分支上
 * 的全部文件修改，使文件尽可能恢复到该请求开始之前的状态。
 */
export interface CheckpointTarget {
    /**
     * agent-cli 会话 ID。
     *
     * agent-cli 使用该字段定位会话历史、当前有效分支以及该会话关联的 Sandbox 备份记录。
     */
    sessionId: string;
    /**
     * CLI 历史 item id（即 `checkpoint/list` 返回的 `messageId`）。
     *
     * 这是 agent-cli 下发的真实 JSONL item id，不是 Renderer 自造的气泡 id。
     */
    messageId?: string;
    /**
     * 会话请求 ID（该轮 model item 的 `conversationRequestId`）。
     *
     * 必须是 agent-cli 记录的真实 request ID。如果两个键都无法定位到当前有效分支上的
     * 轮次，agent-cli 返回 `TARGET_NOT_FOUND`，而不是把它解释为「没有文件需要回退」。
     */
    requestId?: string;
}
/** `checkpoint/list` 请求。 */
export interface CheckpointListRequest {
    sessionId: string;
}
/**
 * checkpoint 概要（`checkpoint/list` 的数组项）。
 *
 * 只包含挑选 checkpoint 所需的最小信息；文件层面的内容要额外调 `checkpoint/read`。
 */
export interface CheckpointSummary {
    /** CLI 历史 item id，可直接作为 `checkpoint/read` 的 `messageId` 回传。 */
    messageId: string;
    /** 同一轮的会话请求 ID，可作为 `checkpoint/read` 的 `requestId` 回传（双键兜底）。 */
    requestId: string;
    /**
     * checkpoint 创建时间（ISO 8601）。
     *
     * 可选：来源是备份记录里的写入时间戳，而该字段是本次对齐 ACP 时才加入 JSONL 的
     * （`FileBackupRecord.ca`）。此前已落盘的历史记录没有它，对这些轮次只能省略而
     * 不是编造一个时间。调用方需能处理缺失。
     */
    createdAt?: string;
    /**
     * 人类可读标签，取该轮用户消息正文的首行截断。
     *
     * 可选：轮次可能没有可提取的文本内容（例如纯附件消息）。
     */
    label?: string;
}
/** `checkpoint/list` 响应。 */
export interface CheckpointListResponse {
    /** 按时间从旧到新排列；只包含确实产生过文件备份的轮次。 */
    checkpoints: CheckpointSummary[];
}
/**
 * `checkpoint/read` 请求。
 *
 * 只读取会话与备份元数据，不修改当前文件，也不改变会话历史指针。
 */
export type CheckpointReadRequest = CheckpointTarget;
/**
 * `checkpoint/read` 响应。
 *
 * 它描述的是「这一个 checkpoint 里有什么」，而不是「即将执行什么」——
 * 因此不含任何执行凭证，调用方读完可以什么都不做。
 *
 * 结构分三层，边界刻意分明：
 * 1. `diff` —— 严格的 ACP v2 载荷，可直接喂给标准 diff 渲染器；
 * 2. `unavailable` / `restoreInfo` —— ACP 装不下、但 UI 必须知道的补充信息；
 * 3. `forkPoint` —— 会话侧能否定位该轮，与文件无关。
 */
export interface CheckpointReadResponse {
    /** 实际命中的 CLI 历史 item id（回显，便于调用方对齐双键解析结果）。 */
    messageId: string;
    /** 实际命中的会话请求 ID（回显）。 */
    requestId: string;
    /** checkpoint 创建时间（ISO 8601）。缺失语义见 `CheckpointSummary.createdAt`。 */
    createdAt?: string;
    /** 人类可读标签。缺失语义见 `CheckpointSummary.label`。 */
    label?: string;
    /**
     * 从当前 workspace 回退到该 checkpoint 所需的变更（ACP v2 Diff）。
     *
     * `changes` 为空数组表示本次回退不涉及文件变化；它与「会话/轮次无法定位」不同，
     * 后者作为请求级错误返回。
     */
    diff: CheckpointDiff;
    /**
     * 在回退范围内但无法恢复的文件，回退后将保持当前内容。
     *
     * 空数组表示整轮都能退回。
     */
    unavailable: CheckpointUnavailableFile[];
    /**
     * `diff.changes` 中 `modify` / `add` 项的版本补充信息，按 `path` 关联。
     */
    restoreInfo: CheckpointRestoreInfo[];
    /**
     * 会话 fork 点解析结果。
     *
     * 放在读侧而不是等写侧（`session/rollback`）执行时才解析，是为了让
     * 「定位不到轮次」在用户看到弹窗**之前**就能降级为「无历史版本」提示。
     * 原先该失败只在执行阶段暴露（`acp-view-rollback.ts` 的
     * 'Cannot resolve fork point'），即用户点完「回退」之后才报错。
     *
     * `found: false` **不是错误**：文件信息仍然有效，调用方据此走降级弹窗。
     */
    forkPoint: {
        found: boolean;
        forkPointId?: string;
    };
}
/**
 * 单个文件的最终执行结果。
 *
 * 该结构与 Sandbox `RestoreModifyBackupResponse.files` 的单项结构保持一致，便于 agent-cli
 * 在单次恢复时直接复用；当一次业务回退涉及多个 Sandbox 提交时，agent-cli 必须先合并
 * 中间结果，再向上层返回每个文件的最终状态。
 */
export interface FileRollbackResult {
    /**
     * 实际尝试恢复或删除的标准化绝对文件系统路径。
     * 同一个文件在一次响应中最多出现一次。
     */
    path: string;
    /**
     * 该文件是否已经达到本次回退计划要求的最终状态。
     *
     * 中间某次 Sandbox 操作失败但后续操作最终成功时，应返回 `true`；
     * 不能直接把中间调用的状态当成最终结果透传。
     */
    success: boolean;
    /**
     * 最终失败原因，仅在 `success` 为 `false` 时返回。
     * 文案用于诊断或失败提示，不应由上层据此反推文件的变更状态。
     */
    error?: string;
}
