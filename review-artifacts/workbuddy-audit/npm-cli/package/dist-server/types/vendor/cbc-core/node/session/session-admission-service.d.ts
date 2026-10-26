import { Logger } from '@celljs/core';
import type { SessionStartSource } from '../../../cbc-shared/node/index.js';
import { Session, SessionManager, type SessionOptions } from './session-protocol';
export type SessionAdmissionRequest = Omit<SessionOptions, 'resume'> & {
    resume?: string | boolean;
    /**
     * `--resume-create-missing`：resume 目标会话不存在时，用同一 id 新建空会话
     * 而不是报错。仅 job-worker 恢复路径使用；用户显式 --resume 不带此开关，
     * 缺会话仍按原语义报 SessionNotFoundError。
     */
    resumeCreateMissing?: boolean;
};
export interface SessionAdmissionResult {
    session: Session;
    source: SessionStartSource;
}
export declare class SessionAdmissionService {
    private readonly sessionIdPattern;
    protected readonly logger: Logger;
    protected readonly sessionManager: SessionManager;
    getOrCreateSession(body: SessionAdmissionRequest): Promise<SessionAdmissionResult>;
    /**
     * 处理 --fork-session 场景
     *
     * 支持的组合：
     * - --fork-session --resume=xxx: 从指定 session fork，自动生成新 ID
     * - --fork-session --resume=xxx --session-id=yyy: 从 xxx fork，使用 yyy 作为新 ID
     * - --fork-session --session-id=xxx: 从指定 session fork，自动生成新 ID
     * - --fork-session --continue: 从最近的 session fork
     */
    handleForkSession(resume: string | boolean | undefined, sessionId: string | undefined, shouldContinue: boolean | undefined, initialOptions: SessionAdmissionRequest): Promise<SessionAdmissionResult>;
    ensureValidSessionId(sessionId: string): void;
    extractSessionId(body: SessionAdmissionRequest): string | undefined;
    findExistingSession(sessionId: string | undefined, shouldContinue?: boolean): Promise<Session | undefined>;
    createNewSession(sessionId: string | undefined, initialOptions: SessionAdmissionRequest): Promise<SessionAdmissionResult>;
    forkSession(originalSession: Session, customId: string | undefined, initialOptions: SessionAdmissionRequest): Promise<SessionAdmissionResult>;
    /**
     * 应用 --resume-session-at 截断。
     *
     * 语义（对齐 Claude Code v2.1.88 print.ts:5106-5119）：
     *   const index = history.findIndex(m => m.id === targetId)
     *   if (index < 0) throw    // 报错退出
     *   history = history.slice(0, index + 1)   // 含目标消息本身
     *
     * 不做消息类型校验（Claude 也是纯 index-based slice）；找不到 id 抛
     * SessionResumeAtNotFoundError（文案对齐 Claude），由既有 error 处理链转 stderr + exit(1)。
     */
    applyResumeSessionAtIfNeeded(session: Session, resumeSessionAt?: string): void;
}
//# sourceMappingURL=session-admission-service.d.ts.map