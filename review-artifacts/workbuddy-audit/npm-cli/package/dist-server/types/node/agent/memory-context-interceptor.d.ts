import { AgentRunInterceptor, AgentRunInterceptorPriority, AgentRunRequest, SessionRunStateMachine } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { MemoryRelevanceService } from '../memory';
import { SettingsManager } from '../settings';
export declare class MemoryContextInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly settingsManager: SettingsManager;
    protected readonly logger: Logger;
    protected readonly memoryRelevanceService?: MemoryRelevanceService;
    protected readonly stateMachine: SessionRunStateMachine;
    intercept(request: AgentRunRequest): Promise<void>;
    /**
     * 检查 Auto Memory 功能是否启用
     */
    private isAutoMemoryEnabled;
    /**
     * 检查团队记忆是否启用
     */
    private isTeamMemoryEnabled;
    /**
     * 获取团队用户 ID
     */
    private getTeamUserId;
    /**
     * 检查 Typed Memory 是否启用（默认启用，与 Claude Code 对齐）
     */
    private isTypedMemoryEnabled;
    /**
     * 判断是否应注入 Memory 上下文
     *
     * 不再仅依赖 session.options.continue 标记（/resume 等场景下可能未设置），
     * 而是增加 fallback：检查第一条 user message 是否已包含 memory system-reminder。
     * 确保 resume 后第一条 user message 的 content 结构与原始会话一致（prompt cache 一致性）。
     */
    private shouldInjectMemoryContext;
    /**
     * 解析这次 run 的记忆落点。
     *
     * 同事（Agent Home colleague job）走私有分区 + 共享只读层（见
     * agent-home-colleague-memory：上游 shard per assistant 的单写者纪律）。
     * 不是同事时逐字节等同原实现——主 Agent / TUI / WorkBuddy 行为不变。
     */
    private resolveMemoryScope;
    /**
     * 生成 Auto Memory 上下文提示
     */
    private generateMemoryPrompt;
    /**
     * Typed Memory Prompt — 使用 buildMemoryPrompt() 与 Claude Code 对齐
     *
     * 包含：4 类型定义、What NOT to save（含显式保存门控）、
     * When to access（含漂移警告）、Before recommending from memory
     */
    private generateTypedMemoryPrompt;
    /**
     * Legacy Memory Prompt — 通用记忆格式（Typed Memory 关闭时使用）
     *
     * 保留独立实现，确保 typedMemory=false 时行为和改动前完全一致：
     * - 无 4 类型系统
     * - 无 YAML frontmatter 要求
     * - 简化的 "What to save" / "What NOT to save" 指导
     */
    private generateLegacyMemoryPrompt;
    /**
     * 注入相关记忆到当前请求
     *
     * ESC 取消支持：Memory Relevance Selection 会调用 memorySelector agent
     * （AgentService.runOneTime），需要让用户在该阶段也能用 ESC 中断。
     * 对齐 InsightsDataAgentRunInterceptor 的做法：
     * 1. 通过 SessionRunStateMachine 推进到 AGENT_RUNNING，让 LoadingBox
     *    的 ESC 逻辑立即生效（pending 态下 ESC 只会延后 abort）
     * 2. 将主 run 的 abortSignal 透传给 selectRelevantMemories
     * 3. abort 时通过 stateMachine.forceIdle 统一回到 IDLE
     */
    private injectRelevantMemories;
    /**
     * 获取相关记忆内容（异步文件读取）
     */
    private getRelevantMemoriesContent;
    /**
     * 从输入中提取最后一条用户消息的原始文本（去除 system-reminder 注入内容）
     */
    private extractLastUserQuery;
}
