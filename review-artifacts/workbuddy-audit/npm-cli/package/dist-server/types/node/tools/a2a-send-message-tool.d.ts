import { Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { FunctionCallItem, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { AbTestService } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { A2aAgentRegistry, A2aArtifactDownloadService, A2aClientService, A2aDiscoveryReadyService } from '../a2a/a2a-protocol';
import { ElicitationService } from '../elicitation/elicitation-service';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const A2ASendMessageParameters: z.ZodObject<{
    agent_id: z.ZodString;
    message: z.ZodString;
    skill_id: z.ZodOptional<z.ZodString>;
    attachments: z.ZodOptional<z.ZodArray<z.ZodObject<{
        url: z.ZodString;
        filename: z.ZodOptional<z.ZodString>;
        media_type: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        filename?: string | undefined;
        media_type?: string | undefined;
    }, {
        url: string;
        filename?: string | undefined;
        media_type?: string | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    message: string;
    agent_id: string;
    attachments?: {
        url: string;
        filename?: string | undefined;
        media_type?: string | undefined;
    }[] | undefined;
    skill_id?: string | undefined;
}, {
    message: string;
    agent_id: string;
    attachments?: {
        url: string;
        filename?: string | undefined;
        media_type?: string | undefined;
    }[] | undefined;
    skill_id?: string | undefined;
}>;
/**
 * A2ASendMessage — invoke one outbound A2A agent (issue #99451 CloudAgent
 * Phase 1; ownership split revised in Phase 2, see the design doc's "A.7
 * Tool ownership split" section). Single, non-looping RPC call: makes
 * exactly one `message/send` request and returns whatever it gets back to
 * the model UNMODIFIED — terminal, `working`, `input-required`, anything.
 * No polling, no streaming, no waiting for a terminal state — that's
 * `A2AGetTaskTool`'s job (see its doc comment), which this tool's own
 * description tells the model to call when the result isn't final.
 *
 * Restricted to the main session: subagent/team sessions never see this tool
 * enabled, which is the enforcement point that prevents A2A-triggered
 * recursive delegation (a subagent cannot itself call out to another A2A
 * agent). Multiple `@` targets are handled by the model issuing several
 * parallel `A2ASendMessage` calls in one turn — there is no separate
 * "multi-agent" tool.
 *
 * Conversation continuity is handled here, not by the model: the A2A
 * `contextId` returned by a call is remembered per `(session, agentId)` and
 * replayed on the next call to that agent, so the remote side sees one
 * continuing conversation. The model never sees or supplies the id. See
 * a2a-context-store.ts for the storage, isolation and expiry rules.
 */
export declare class A2ASendMessageTool extends BaseTool implements Tool {
    protected readonly registry?: A2aAgentRegistry;
    protected readonly client?: A2aClientService;
    protected readonly abTestService?: AbTestService;
    protected readonly discoveryReadyService?: A2aDiscoveryReadyService;
    protected readonly downloadService?: A2aArtifactDownloadService;
    protected readonly sessionManager?: SessionManager;
    protected readonly elicitationService?: ElicitationService;
    protected readonly logger: Logger;
    name: ToolNames;
    description: string;
    needsApproval: boolean;
    parameters: z.ZodObject<{
        agent_id: z.ZodString;
        message: z.ZodString;
        skill_id: z.ZodOptional<z.ZodString>;
        attachments: z.ZodOptional<z.ZodArray<z.ZodObject<{
            url: z.ZodString;
            filename: z.ZodOptional<z.ZodString>;
            media_type: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            url: string;
            filename?: string | undefined;
            media_type?: string | undefined;
        }, {
            url: string;
            filename?: string | undefined;
            media_type?: string | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        message: string;
        agent_id: string;
        attachments?: {
            url: string;
            filename?: string | undefined;
            media_type?: string | undefined;
        }[] | undefined;
        skill_id?: string | undefined;
    }, {
        message: string;
        agent_id: string;
        attachments?: {
            url: string;
            filename?: string | undefined;
            media_type?: string | undefined;
        }[] | undefined;
        skill_id?: string | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    isEnabled: (args: {
        runContext: RunContext<Session>;
    }) => Promise<boolean>;
    execute(input: z.infer<typeof A2ASendMessageParameters>, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    /**
     * On an authorization failure from the remote endpoint, ask the host to
     * authorize and report whether the send is worth retrying.
     *
     * Returns `true` only for the one path that can actually help: the failure
     * is an auth failure per {@link authFailureOf} (HTTP 401, or an
     * allowlisted business code when the transport reports no 401), an
     * `ElicitationService` is bound, this session has a live elicitation
     * channel, and the host answered `accept`. Every other combination returns
     * `false`, so a TUI session, a client that never declared
     * `elicitation.form`, a decline, a dismissal or a timeout all keep the
     * pre-existing "surface the error" behavior rather than hanging.
     *
     * `accept` means the host completed authorization out of band — exactly the
     * contract `A2AGetTaskTool`'s approval card already uses. No credential is
     * returned to, or held by, agent-cli: outbound A2A auth is handled by the
     * infrastructure the calls are routed through (see
     * `A2aClientServiceImpl.createClient`), so a retry simply re-sends.
     *
     * No `timeoutMs`: `elicit()` owns a bounded default and the host
     * synthesizes an answer of its own, so a timeout arrives as `cancel`.
     *
     * Throws `ToolCancelledError` when the session is aborted while the card
     * is open — a user stop, not an authorization outcome.
     */
    private authorizeAfterAuthFailure;
    /**
     * Flush the updated continuation map to the session transcript, following
     * the same "mutate session.meta, then save" shape the other whitelisted
     * meta keys use (see main-agent-session.ts).
     *
     * Two deliberate properties:
     *
     *  - **No-op for served sessions.** `save()` returns early when session
     *    persistence is disabled, so ACP / gateway sessions keep the
     *    in-memory map and simply write nothing.
     *  - **Never fails the A2A call.** The remote agent has already done the
     *    work by this point; losing the continuation pointer costs the next
     *    call its context, which is a far smaller loss than turning a
     *    succeeded call into a tool error.
     */
    private persistContinuation;
}
export {};
