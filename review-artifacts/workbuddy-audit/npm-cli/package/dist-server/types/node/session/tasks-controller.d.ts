/**
 * Tasks Controller
 *
 * 提供任务模版推荐 API，采用异步后台方案：
 *   POST /tasks/templates/refresh → 触发后台 AI 推荐（fire-and-forget），立即返回
 *   GET  /tasks/templates         → 返回缓存的模版列表 + 当前状态
 *
 * 后台 AI 推荐通过 spawn cbc 子进程完成，结果缓存在内存中，前端通过轮询 GET 获取最新结果。
 *
 * 可配置项（环境变量）:
 *   CODEBUDDY_TASK_RECOMMEND_TIMEOUT  AI 推荐超时时间（毫秒），默认 120000（120 秒）
 *   CODEBUDDY_TASK_RECOMMEND_MODEL    AI 推荐使用的模型名（可选，不设置则使用默认模型）
 */
/** 任务模版数据结构 */
export interface TaskTemplate {
    id: string;
    title: string;
    description: string;
    icon: string;
    command: string;
    interval: string;
}
/**
 * 推荐子进程的最大 agentic 轮数。
 *
 * 不能设成 1：模型为了「根据当前工作目录的项目特征」作答，通常会先用一次
 * Bash/Glob 探查项目结构，这会把第1 轮用光，于是直接撞上上限并返回
 * `subtype=error_during_execution` +空 result（exit code仍是 0），
 * 表现为「刷新模版」失败。留出探查+ 作答的余量。
 */
export declare const MAX_TURNS = 4;
/**
 * 推荐子进程的 spawn 环境。
 *
 * 走 {@link buildNestedCbcSpawnEnvironment} 剥离 `SERVER__PORT`/`SERVER__HOST`：
 * 本控制器运行在 `--serve` 进程内，若子进程继承父进程正在监听的端口，会bind
 * 到已占用地址并静默挂死，表现为「刷新模版」永远超时失败。
 */
export declare function buildRecommendationSpawnEnv(): NodeJS.ProcessEnv;
export declare class TasksController {
    private readonly logger;
    private cachedTemplates;
    private cacheStatus;
    private cachedAt;
    private cacheError;
    /**
     * GET /api/v1/tasks/templates
     * 返回当前缓存的模版列表和加载状态。
     * 前端通过轮询此端点获取 AI 推荐的最新结果。
     *
     * 即使没有 sessionId，也返回默认模版列表，让用户能看到任务视图。
     */
    getTemplates(): Promise<void>;
    /**
     * POST /api/v1/tasks/templates/refresh
     * 触发后台 AI 推荐。立即返回当前状态，子进程在后台异步执行。
     * 如果已有推荐进行中，不会重复启动。
     * 即使没有 sessionId，也允许刷新（使用当前工作目录）。
     */
    refreshTemplates(): Promise<void>;
    /**
     * 在后台启动 cbc 子进程执行 AI 推荐。
     * 完成后更新内存缓存。不会抛出异常（所有错误内部处理）。
     */
    private startBackgroundRecommendation;
    /**
     * 从 stream-json 输出格式解析 AI 结果。
     * 每行是一个 JSON 对象，我们寻找 type: 'result' 或 type: 'assistant' 的消息。
     */
    private parseStreamJsonOutput;
    /**
     * 从 AI 回复文本中解析任务模版 JSON。
     * 支持多种格式：纯 JSON 数组、```json 代码块、文本中嵌入的 JSON。
     */
    private parseTemplates;
    /**
     * 验证并清洗模版数据。
     */
    private validateTemplates;
}
