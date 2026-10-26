export declare const CUSTOM_INPUT_ITEM_TYPES: string[];
/** Durable recovery admission. A missing matching terminal means the outcome is unknown. */
export interface RequestRecoveryItem {
    type: 'request-recovery';
    id: string;
    parentId: string;
    timestamp: number;
    requestId: string;
    userMessageId: string;
    /** Request-local sequence; the original execution is attempt 1. Never a public identity. */
    attempt: number;
    providerData?: Record<string, unknown>;
}
/**
 * 主模型自身响应之外结算的积分（子代理 / 团队成员、生图等生成工具），按主对话轮次记账。
 * Metadata only：不送模型、不渲染。主模型的积分仍记在其输出条目的 `rawUsage.credit` 上，
 * 两者相加即该轮总消耗，与 ACP `usage_update.cost` 推送口径一致。
 */
export interface CreditUsageItem {
    type: 'credit-usage';
    id: string;
    parentId?: string;
    timestamp: number;
    providerData: Record<string, unknown> & {
        /** 积分归属的主对话轮次（与 `usage_update._meta['codebuddy.ai/requestId']` 同源） */
        conversationRequestId: string;
        credit: number;
        source: 'team_member' | 'generation_tool';
        /** 结算阶段唯一标识，回放按它去重 */
        stageId: string;
        messageId?: string;
    };
}
/** A completed model response whose usage has no committed output item.
 * Metadata only: never submitted to the model or displayed as a message.
 * Uses the same provider usage and generation identity as normal output items.
 */
export interface ModelUsageItem {
    type: 'model-usage';
    id: string;
    parentId?: string;
    timestamp: number;
    providerData: Record<string, unknown> & {
        messageId: string;
        rawUsage: Record<string, unknown>;
        usage: Pick<import('@openai/agents-core').ModelResponse['usage'], 'inputTokens' | 'outputTokens' | 'totalTokens'>;
    };
}
/** Durable terminal commit used by canonical ACP replay. */
export interface AcpTerminalStateItem {
    type: 'acp-terminal-state';
    id: string;
    /** The active conversation item at the terminal boundary. */
    parentId: string;
    timestamp: number;
    requestId: string;
    rootRequestId: string;
    /** Internal execution sequence. Legacy terminal records belong to attempt 1. */
    attempt?: number;
    stopReason: string;
    /**
     * ACP Session cost at this durable turn boundary.
     *
     * `amount` is cumulative for the Session, matching `usage_update.cost`;
     * it is not the cost delta of this turn. Older journals may omit it and
     * replay falls back to the persisted provider usage records.
     */
    cost?: {
        amount: number;
        currency: string;
    };
    error?: {
        code: string;
        message: string;
        additionalDetails?: string | null;
        httpStatusCode?: number | null;
        businessCode?: number;
        /** User-facing text the model service supplied, keyed by language tag. */
        display?: {
            message?: Record<string, string>;
            tips?: Record<string, string>;
            actions?: string[];
        };
        /** Capacity queue facts the model service supplied with its business code. */
        queue?: {
            position?: number;
            size?: number | string;
            estimatedWait?: number;
            retryAfter?: number;
            userType?: string;
        };
        customModel?: boolean;
    };
    providerData?: Record<string, any>;
}
/**
 * resend/edit fork 墓碑标记（issue #50495）
 *
 * 持久化到 JSONL 的 marker item。当用户对某条历史 user 消息执行 resend / edit 时，
 * `AcpViewImpl.applyResendFork` 会同步往 history append 一条此类 item，确保：
 *
 * 1. 冷加载（CLI 重启 / desktop 重连）后，`HistoryUtils.resolveReplayHistory` 能识别
 *    "本会话发生过 fork"，从而走 parentId fork 链路而不是原样返回全部历史
 *    （否则 lastMessageId 是运行态字段、重启后丢失，会让 resolveReplayHistory:74
 *    的守卫命中"冷加载无 content_filter notice"分支，把已 fork 的旧分支全部 replay 回前端）。
 *
 * 2. 作为 custom item，自动从 model input / ACP replay 显示中剔除——LLM 不喂、前端不画。
 *
 * 3. parentId 指向 fork 点，与 fork 后兄弟分支同 parent；getActiveHistory 沿 parentId
 *    回溯时跳过 custom item，与既有 file-history-snapshot 等行为一致。
 */
export interface ResendForkNoticeItem {
    /** 类型标识 */
    type: 'resend-fork-notice';
    /** 必填：notice 自身 id（用于 JSONL 持久化与去重） */
    id: string;
    /** fork 点 = 被编辑用户消息的父节点（与 fork 后新 user 消息同 parent，root 时为 undefined） */
    parentId?: string;
    /** 时间戳（写入时刻） */
    timestamp: number;
    /** 被编辑 user 消息的 CLI item id（仅用于日志/排查，不参与 fork 逻辑） */
    editedUserItemId?: string;
    /** 必要扩展参数（与其他 custom item 对齐） */
    providerData?: Record<string, any>;
}
/** 快照中的跟踪文件信息 */
export interface TrackedFileBackup {
    /**
     * 备份文件名，格式：hash@v{version}
     */
    backupFileName?: string;
    /** 版本号 */
    version: number;
    /** 文件备份更新时间 */
    backupTime: number;
    /**
     * 首次跟踪该文件时（version 0→1），磁盘上是否已存在该文件。
     *
     * 用于 checkpoint 回退时区分两种"缺少 v1 备份"的情况：
     * - existedAtTrack === false：文件在追踪前本就不存在（新建文件），缺少备份是预期状态，
     *   回退到追踪之前可以安全删除。
     * - existedAtTrack === true：文件当时存在，但备份从未成功写入磁盘（磁盘满/权限等故障）。
     *   此时缺少备份不代表文件不存在，绝不能据此删除用户现有文件。
     * - undefined：旧数据（写入本字段之前创建的 checkpoint）或从未成功跑过初始化策略，
     *   视为"未知"，回退时按 true 同样处理，保守不删除。
     */
    existedAtTrack?: boolean;
}
/** 文件历史快照信息，记录工具执行前的文件状态 */
export interface FileHistorySnapshotPayload {
    /**
     * 当前用户消息回合的 messageId
     * 在一个用户消息回合中的所有快照共享同一个 messageId
     */
    messageId: string;
    /**
     * 文件路径到备份信息的映射
     * 示例：{ "path/to/file.ts": { backupFileName: "abc@v1", version: 1, ... } }
     */
    trackedFileBackups: Record<string, TrackedFileBackup>;
}
/** 文件历史快照消息项 */
export interface FileHistorySnapshotItem {
    /** 消息类型标识 */
    type: 'file-history-snapshot';
    /** 同 snapshot.messageId：关联消息，不是快照自身 ID。旧记录可能只有嵌套字段。 */
    messageId?: string;
    /**
     * 关联消息的 ID
     * 两个场景：
     * - updateSnapshot: 用户消息的 messageId
     * - trackFile: 工具执行的 toolCallId
     */
    parentId?: string;
    /** 消息时间戳 */
    timestamp: number;
    /**
     * 跟踪文件缓存是否有新增文件
     * - true: 有新增文件（trackFile，首次跟踪文件并加入缓存）
     * - false: 无新增文件（updateSnapshot，只检查已跟踪文件的变化）
     */
    isSnapshotUpdate: boolean;
    /** 快照数据 */
    snapshot: FileHistorySnapshotPayload;
    /** 仅兼容旧 JSONL；新 snapshot 不生成 entry ID。 */
    id?: string;
    providerData?: Record<string, any>;
}
//# sourceMappingURL=custom-input-item-types.d.ts.map