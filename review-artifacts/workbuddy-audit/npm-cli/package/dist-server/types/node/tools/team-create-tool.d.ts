import { Session } from '../../vendor/cbc-core/node/index.js';
import { type AgentInputItem, RunContext, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { z } from 'zod';
import { TeamMemberRegistry } from '../agent-team/team-member';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
export declare function getTeamMemberRegistry(): TeamMemberRegistry;
export declare function stopTeamLeadPoller(sessionId?: string): void;
/**
 * 立即把 team-lead 收件箱中的未读消息投递给 lead（唤醒新一轮或并入当前轮），
 * 不等下一次轮询。投递失败（如取消后 lead 收件箱暂停）时消息保持未读，交给后续轮询。
 *
 * #154806：框架通知写入 lead 收件箱后若只等轮询，ACP prompt 会在"已写信、lead 未读"
 * 的窗口内被判定 team 已静默而提前完结，lead 随后仍以上一轮 requestId 继续输出。
 */
export declare function kickTeamLeadInbox(teamName: string): Promise<void>;
export declare function setLeadInboxPaused(session: Session, paused: boolean): void;
export declare function isLeadInboxPaused(session: Session): boolean;
/**
 * Pause all team-internal follow-up dispatch into the lead session after cancel.
 *
 * Two independent wake-up sources must be gated together:
 * 1. lead inbox polling (future teammate/framework messages)
 * 2. rich queue auto-dispatch (items already queued before cancel)
 *
 * Messages are preserved; they are only deferred until the next explicit user
 * prompt resumes the flow.
 */
export declare function pauseTeamLeadFollowUpDispatch(session: Session): void;
/**
 * The user's Stop on a team lead: hold team-internal follow-ups, record the
 * paused runtime, and soft-pause this lead's members. Shared by ACP cancel and
 * the resident Server interrupt so both hosts keep one cancel contract.
 */
export declare function pauseTeamAfterLeadCancel(session: Session): Promise<void>;
/**
 * A resident host admits teammate mail as its own continuation turn while the
 * lead is busy. If the user stops the lead before that turn starts, starting it
 * would re-wake the lead (#146406). Hold the batch instead; it is re-admitted
 * after the next human turn resumes dispatch.
 *
 * @returns true when the batch was held and must not run now.
 */
export declare function deferPausedTeamLeadContinuation(session: Session, input: AgentInputItem[]): boolean;
/**
 * Resume team-internal follow-up dispatch when the user explicitly starts a new
 * turn after cancel.
 */
export declare function resumeTeamLeadFollowUpDispatch(session: Session): void;
/**
 * Start polling team-lead's inbox for messages from teammates.
 *
 * Idempotent per session: a lead that is already polling is left alone.
 * Another lead in the same process still gets its own poller.
 *
 * - Always pushes to session.inputSubject for UI rendering.
 * - If the main agent is running → enqueue message so it gets picked up
 *   in the current turn.
 * - If the main agent is idle → trigger a new agent turn via AgentService.run
 *   so the agent processes the teammate's message immediately.
 *
 * Also registers this session with the TeamInboxDispatchService so that, when
 * the lead finishes the current turn (`agent_end`), any items queued during
 * that turn get auto-activated into a new independent run. Without this,
 * Mode B messages would sit in the rich queue with nobody to dispatch them.
 */
export declare function startTeamLeadInboxPolling(teamName: string, session: Session): void;
/**
 * TeamCreate tool - creates a new team for multi-agent collaboration.
 *
 * Creates:
 *   ~/.codebuddy/teams/{team-name}/config.json
 *   ~/.codebuddy/teams/{team-name}/inboxes/
 *   ~/.codebuddy/tasks/{team-name}/
 */
export declare class TeamCreateTool extends BaseTool implements Tool {
    protected readonly logger: Logger;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        team_name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        agent_type: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        team_name: string;
        description?: string | undefined;
        agent_type?: string | undefined;
    }, {
        team_name: string;
        description?: string | undefined;
        agent_type?: string | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    needsApproval: boolean;
    /**
     * Keep deferred-tool discovery aligned with the runtime feature gate.
     * Otherwise TeamCreate remains visible in ToolSearch after Agent Teams is disabled.
     */
    shouldShowInToolSearch: () => boolean;
    isEnabled: () => boolean;
    private isAgentTeamsEnabled;
    execute(input: {
        team_name: string;
        description?: string;
        agent_type?: string;
    }, context?: RunContext<Session>): Promise<ToolResult>;
}
