/**
 * API v1 — Sessions
 *
 * 公开 REST API 端点：
 *   GET    /api/v1/sessions             → 返回会话列表（支持 cwd 查询参数控制查询范围）
 *   DELETE /api/v1/sessions/:id         → 删除指定会话
 *   POST   /api/v1/sessions/:id/rename  → 重命名指定会话
 *
 * 已废弃端点（保留向下兼容）：
 *   GET    /api/v1/sessions/across-projects → 使用 GET /api/v1/sessions?cwd=* 代替
 *   GET    /api/v1/sessions/workspaces      → 使用 GET /api/v1/sessions?cwd=* 代替
 */
export declare class SessionController {
    private readonly sessionManager;
    private readonly storage;
    private readonly agentService;
    private readonly acpAgentManager?;
    private readonly acpStreamManager?;
    /**
     * 检查历史是否为空（只包含系统自动生成的消息，如 /clear 命令的消息）
     */
    private isEmptyHistory;
    /**
     * GET /api/v1/sessions → 返回会话列表
     *
     * Query params:
     *   - cwd?: string  工作目录参数：
     *     - 不传：返回当前工作空间的会话
     *     - 指定目录：返回该工作空间的会话
     *     - '*'：返回所有工作空间的会话
     *   - projectId?: string  按压缩工作目录名过滤特定项目（仅当 cwd=* 时有效）
     */
    list(): Promise<void>;
    getLiveSession(): Promise<void>;
    /**
     * GET /api/v1/sessions/across-projects → 返回所有工作目录的会话列表（已废弃，使用 GET /api/v1/sessions?cwd=* 代替）
     *
     * 为了向下兼容性保留
     *
     * Query params:
     *   - projectId?: string  按压缩工作目录名过滤特定项目
     */
    listAcrossProjects(): Promise<void>;
    /**
     * GET /api/v1/sessions/workspaces → 返回已知工作区列表（已废弃，使用 GET /api/v1/sessions?cwd=* 代替）
     *
     * 扫描 ~/.codebuddy/projects/ 下所有项目目录，
     * 从每个项目的会话文件中提取原始 cwd，返回去重后的工作区列表。
     *
     * 为了向下兼容性保留
     */
    listWorkspaces(): Promise<void>;
    /**
     * GET /api/v1/sessions/pins?cwd= → { pinned: string[] }
     *
     * 置顶集合按项目目录分片，与会话文件同处一个目录。
     */
    getPins(cwd?: string): Promise<void>;
    /**
     * PUT /api/v1/sessions/pins?cwd= ← { sessionId, pinned } → { pinned: string[] }
     */
    putPins(cwd: string | undefined, body: {
        sessionId?: string;
        pinned?: boolean;
    }): Promise<void>;
    /**
     * DELETE /api/v1/sessions/:id → 删除指定会话
     *
     * 查询参数：
     *   ?cwd=PATH 该会话所属项目目录，传入时一并清理它在该项目下的置顶记录。
     */
    remove(id: string, cwd?: string): Promise<void>;
    /**
     * POST /api/v1/sessions/:id/rename → 重命名指定会话
     * 请求体: { name: string }
     */
    rename(id: string, body: {
        name?: string;
    }): Promise<void>;
    /**
     * GET /api/v1/sessions/:id/history → 返回会话的对话历史摘要
     *
     * 为 Pulse 灵感生成系统设计，返回每个 user→assistant 对的精炼信息。
     * 不返回完整消息内容，只返回 Stage 1 信号提取所需的三要素。
     *
     * Response:
     * {
     *   sessionId: string,
     *   name: string,
     *   requests: Array<{
     *     userInput: string,
     *     finalReply: string
     *   }>
     * }
     */
    getHistory(id: string): Promise<void>;
    /**
     * GET /api/v1/sessions/:id/replay → 返回可直接回放到 UI 的完整事件序列
     *
     * 返回值复用 ACP loadSession 的 replay 组装逻辑，但不要求建立 ACP 连接。
     * desktop 可直接消费这些事件，避免为了查看历史而拉起完整 session runtime。
     *
     * 查询参数：
     *   ?limit=N  显式指定 session history 加载上限（item 数）。
     *             不传则走 SessionStore 的默认上限（见 SESSION_HISTORY_DEFAULT_LIMIT）。
     *             由调用方（如 Desktop）根据自身展示需求决定；agent-cli 本身不硬编码
     *             "展示型"具体数值，避免共享代码反向依赖特定宿主产品的 UI 约束。
     *   ?cwd=PATH 优先从该工作目录对应的 project 历史文件读取，避免跨 project 扫描。
     */
    getReplay(id: string, limit?: string, cwd?: string): Promise<void>;
    replySession(id: string, body: {
        text?: string;
    }): Promise<void>;
    private resolveLiveSessionFollow;
    /**
     * Extract projectId (compressed working directory name) from a session.
     * Looks for the first history item with a cwd field and compresses it.
     */
    private extractProjectId;
    private extractCwd;
    /**
     * Extract cwd from the first session file in a project directory.
     * Reads only the first line of the first .jsonl file to minimize I/O.
     */
    private extractCwdFromProjectDir;
}
