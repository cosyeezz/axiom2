/**
 * 智能体档案上的系统提示词 → 本轮会话（Web UI 暴露的 `--system-prompt` / `--append-system-prompt`）。
 *
 * 每轮按会话归属重新解析一次：用户在 Web UI 改了档案，下一轮就生效，不用重启 job。
 * 写的是 session-profile-prompt 的独立槽位，不碰 `session.options`（那属于会话发起方，
 * 例如定时任务的 appendSystemPrompt），两边互不覆盖。
 *
 * 归属判据：
 * - 明确登记过的会话（jobAssignments / sessionAssignments，含定时任务登记的分身）用登记的智能体；
 * - 其余只有 Agent Home 表面上的会话才回落默认 Agent（分身）—— 和侧栏「未认领会话都归分身」同口径；
 *   TUI / CLI / WorkBuddy 的会话一律不注入。
 */
import { AgentRunInterceptor, AgentRunInterceptorPriority, type AgentRunRequest, type Session } from '../../vendor/cbc-core/node/index.js';
import { type AgentHomeDirectoryFile, type AgentHomeProfile } from './agent-home-directory';
import type { AgentHomeSystemPrompt } from './agent-home-system-prompt';
/** 这条会话的系统提示词该取哪个智能体的档案；undefined = 不取。 */
export declare function resolveAgentHomePromptOwner(directory: AgentHomeDirectoryFile, jobId: string | undefined, sessionId: string | undefined, onSurface: boolean): AgentHomeProfile | undefined;
export declare function resolveAgentHomeSessionSystemPrompt(session: Session): Promise<AgentHomeSystemPrompt | undefined>;
export declare class AgentHomeProfilePromptInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    intercept(request: AgentRunRequest): Promise<void>;
}
