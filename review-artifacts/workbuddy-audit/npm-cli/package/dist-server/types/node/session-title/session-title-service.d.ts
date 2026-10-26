import { AgentService, type Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { GalileoService } from '../galileo';
import { TerminalTitleUpdater } from '../terminal/terminal-protocol';
import { SessionTitleServiceInterface } from './session-title-protocol';
export declare class SessionTitleServiceImpl implements SessionTitleServiceInterface {
    protected readonly agentService: AgentService;
    protected readonly sessionManager: SessionManager;
    protected readonly terminalTitleUpdater?: TerminalTitleUpdater;
    protected readonly galileoService?: GalileoService;
    protected readonly logger: Logger;
    /**
     * Per-session title-generation state (idempotent latch + retry bookkeeping).
     */
    private sessionStates;
    /**
     * Pending title generation promises per session.
     * Used by ACP view to wait before pushing title update.
     */
    private pendingTitlePromises;
    /**
     * Whether the service is force-enabled (non-interactive mode).
     */
    private forceEnabled;
    /** Environment-based disable flag */
    get disabled(): boolean;
    protected init(): void;
    setForceEnabled(enabled: boolean): void;
    getPendingTitlePromise(sessionId: string): Promise<void> | undefined;
    /**
     * Main entry point called by the hook on each USER_PROMPT_SUBMIT.
     *
     * Idempotent-latch model (aligned with Claude Code): a title is generated
     * from the first real user message and retried on every subsequent prompt
     * until it succeeds or reaches the failure cap. Once a valid title exists,
     * generation never runs again for the session. This replaces the previous
     * count===1 / count===3 window model, where a single failed generation left a session permanently
     * untitled.
     */
    handleUserPromptSubmit(prompt: string, session: Session): Promise<void>;
    private shouldProcessPrompt;
    private getOrCreateState;
    /**
     * Rebuild latch state when a session is first observed (including resume).
     *
     * `titled` is seeded from whether the history already contains a real
     * generated title. `hasGeneratedTitle` filters placeholder titles (e.g.
     * `(No content)` / `/compact`) using the same definition as
     * `getEffectiveSessionTitle`, so a placeholder never counts as titled.
     *
     * Note (intentional divergence from Claude): Claude seeds its latch from
     * "history is non-empty", so a resumed session with no title is never
     * backfilled. We seed from "has a real title", so a resumed session that
     * was never successfully titled (created before the feature, or a prior
     * generation failed) will generate one on the next prompt — the backfill
     * behavior falls out naturally from the latch, with no special-case field.
     */
    private createStateFromHistory;
    private generateAndPersistTitle;
    /**
     * 补推一条 live（非 replay）会话标题到 ACP 连接，使 daemon 回写 DB.title。
     *
     * 用运行时懒获取 + 容错，而不是 `@Autowired`：SessionTitleService 属底层业务，不应
     * 静态依赖 acp 协议层（会让 headless / 无 ACP 连接的装配路径被迫拉起 acp 单例）。
     * 拿不到广播服务（headless、未装配、TUI 无连接）时静默跳过——DB 回写只是"锦上添花"，
     * 缺失不影响标题已落 JSONL 这一事实。
     */
    private broadcastLiveTitle;
    private recordFailure;
    private reportGenerated;
    /**
     * Run the title generator with an isolated one-shot session that preserves
     * the parent session's selected model context. This lets `builtin-lite`
     * resolve against the same primary model as the parent session while
     * keeping title-generation history, abort state, and trace state isolated.
     */
    private generateTitle;
    private createTitleGenerationSession;
    /**
     * Bound both model work and our wait. The deadline aborts the one-shot run;
     * Promise.race is only a backstop for a provider that ignores cancellation.
     *
     * Errors are swallowed into a `null` result (rather than thrown) so the
     * caller can uniformly decide whether to retry, without a try/catch at
     * every call site.
     *
     */
    private attemptGeneration;
    /**
     * Parse the AI response to extract a title string.
     * The TERMINAL_TITLE_GENERATOR returns JSON like { "isNewTopic": ..., "title": "..." }.
     * The `isNewTopic` field is kept in the prompt output purely for downstream
     * structural compatibility — this service only consumes `title`. Bare
     * { "title": "..." } responses are also accepted.
     */
    private parseResponse;
    private extractTitleFromParsedResponse;
    private extractJsonFromResponse;
}
