import { Session } from '../../vendor/cbc-core/node/index.js';
import { FunctionCallItem, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { AbTestService } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { A2aAgentRegistry, A2aArtifactDownloadService, A2aClientService, A2aDiscoveryReadyService, A2aTaskStatus } from '../a2a/a2a-protocol';
import { ElicitationService } from '../elicitation/elicitation-service';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const A2AGetTaskParameters: z.ZodObject<{
    agent_id: z.ZodString;
    task_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    task_id: string;
    agent_id: string;
}, {
    task_id: string;
    agent_id: string;
}>;
export declare const ENV_POLL_INTERVAL_MS = "CODEBUDDY_A2A_POLL_INTERVAL_MS";
export declare const ENV_POLL_MAX_DURATION_MS = "CODEBUDDY_A2A_POLL_MAX_DURATION_MS";
export interface A2APollPolicy {
    /**
     * Constant gap between polls, ms. Default 500ms.
     *
     * Flat rather than exponentially backed off. Backoff optimizes for the
     * long tail, but the tail is exactly where it hurts: it used to stretch
     * to a 30s gap, so a task finishing at second 31 was reported up to 30
     * seconds late, and the user watching the progress line saw a stall. A
     * remote task the user is actively waiting on is worth one cheap request
     * every half second.
     */
    intervalMs: number;
    /**
     * Wall-clock budget for the whole loop, ms. Default 30 minutes.
     *
     * A HARD cap: when it runs out the remote task is canceled, so this is
     * the longest a single outbound task may run — not merely the longest a
     * single call waits.
     */
    maxDurationMs: number;
}
/**
 * Resolve the effective poll policy, applying any env overrides on top of
 * `DEFAULT_POLL_POLICY`. Read fresh on every `execute()` call — not cached
 * — so a test/host can change the env between calls.
 *
 * Only these two knobs are exposed. The retry schedule for a FAILED request
 * (see a2a-poll-retry.ts) is fixed, because the cadence and the budget are
 * the only two a host has a reason to tune and every additional dial is one
 * more way to configure the loop into a request storm.
 */
export declare function resolvePollPolicy(): A2APollPolicy;
/** Exported so `A2ASendMessageTool` can classify its own (single, non-looping) result the same way — see that tool's artifact-download integration. */
export declare function isTerminal(status: A2aTaskStatus): boolean;
/** Test-only reset of {@link userStoppedTasks} (process-lifetime map in production). */
export declare function __resetUserStoppedTasksForTest(): void;
/**
 * A2AGetTask — wait for a previously created outbound A2A task to finish
 * (issue #99451 CloudAgent Phase 1; Phase 2 revises this from a bare
 * single-shot query into the tool that owns the ENTIRE bounded, streamed
 * poll loop — see the design doc's "A.7 Tool ownership split" section).
 *
 * Every non-terminal status — including `input-required`/`auth-required` —
 * is relayed (A.2's live-progress mechanism, reusing the foreground Bash
 * tool's `session.inputSubject.next({status: 'in_progress', ...})` pattern)
 * and polled straight through at a fixed interval (A.3), never treated as a
 * stop condition (A.5).
 *
 * Three things stop the loop, and only one of them is a plain success:
 *
 * - one of the 4 terminal states (`completed`/`failed`/`canceled`/`rejected`);
 * - the wall-clock budget running out;
 * - `tasks/get` failing in a way that survives the retry schedule.
 *
 * The last two both END the remote task: the loop issues `tasks/cancel` and
 * reports what that cancel actually did. This is a deliberate reversal of the
 * older "give up for now, let the model re-poll" contract, which left a
 * remote task running with nobody watching it whenever the model chose not to
 * call back. The cost is that the budget is now a ceiling on the TASK, not
 * just on the call — a task that needs longer than `maxDurationMs` cannot
 * finish, and the host has to raise the budget for it.
 *
 * **One exception, added in issue #107183: approval interrupts.** When a poll
 * observes a `snapshot.approval` payload (an out-of-band approval the remote
 * agent is waiting on — see `A2aTaskSnapshot.approval`), relaying opaque
 * `(N pending approval)` text and polling on until the budget runs out gives
 * the user no way to act. So the loop PAUSES and raises an ACP `elicitation/create`
 * card carrying the approval tokens, then resumes or stops per the answer:
 *
 * - `accept` — resume polling and do nothing else. The host delivers the
 *   approval out of band (agent-cli never submits it: it has neither the
 *   approving system's endpoint nor the user's credentials there), so the
 *   task's own recovery is what the next poll observes.
 * - `decline` — the user said no. Cancel the remote task and report the real
 *   cancel outcome, so nothing is left orphaned waiting on an approval that
 *   will never come.
 * - `cancel` — no answer (card dismissed, or the host's 10-minute fallback).
 *   Same handling as `decline`, but the model is told nobody answered rather
 *   than that the user refused.
 *
 * Every poll that still carries an approval payload raises its own card, and
 * agent-cli deliberately does NOT suppress repeats. A `tasks/get` is a
 * stateless read, so a task genuinely waiting on an approval reports it on
 * every poll; deciding whether the user has already been asked means knowing
 * whether a panel for those tokens is still on screen, which only the host
 * knows. The host therefore owns dedup, keyed on the approval identity this
 * carries in `_meta['codebuddy.ai'].a2aApproval.tokenIds`. An earlier version
 * deduped here on a whole-snapshot signature plus a 3-card cap; that signature
 * also covered the remote's progress narration (it shares `status.message`
 * with the approval part), so unrelated text churn read as a new approval,
 * and the cap then silently dropped the 4th genuinely-different approval of a
 * task.
 *
 * If the session has no elicitation channel at all (TUI, or an SDK client
 * that never declared `elicitation.form`), this falls back to exactly the
 * pre-#107183 behavior: relay and keep polling. The branch is additive.
 *
 * Restricted to the main session, same recursive-delegation guard as
 * `A2ASendMessageTool` (see that tool's doc comment).
 */
export declare class A2AGetTaskTool extends BaseTool implements Tool {
    protected readonly registry?: A2aAgentRegistry;
    protected readonly client?: A2aClientService;
    protected readonly abTestService?: AbTestService;
    protected readonly discoveryReadyService?: A2aDiscoveryReadyService;
    protected readonly downloadService?: A2aArtifactDownloadService;
    /**
     * Optional so a session without any elicitation channel — and the unit
     * tests, which construct this tool directly without a DI container —
     * fall back to the pre-#107183 relay-and-keep-polling behavior instead
     * of failing.
     */
    protected readonly elicitationService?: ElicitationService;
    protected readonly logger: Logger;
    name: ToolNames;
    description: string;
    needsApproval: boolean;
    parameters: z.ZodObject<{
        agent_id: z.ZodString;
        task_id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        task_id: string;
        agent_id: string;
    }, {
        task_id: string;
        agent_id: string;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    isEnabled: (args: {
        runContext: RunContext<Session>;
    }) => Promise<boolean>;
    execute(input: z.infer<typeof A2AGetTaskParameters>, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    /**
     * One logical poll: a `tasks/get`, plus up to
     * {@link POLL_RETRY_MAX_ATTEMPTS} retries when the failure looks
     * transient.
     *
     * Retrying at all is the point. Before this, a single hiccup — a 502 from
     * a load balancer mid-deploy, a reset socket — ended a poll the user had
     * been waiting minutes for. What is NOT retried is a 400-409: those say
     * the request itself is wrong (bad task id, no permission), and repeating
     * it five times just delays telling the model something it needs to act
     * on. See `classifyPollFailure` for where that line is drawn and why it
     * is not simply "all of 4xx".
     *
     * Three ways out:
     * - a snapshot, on the first try or a later one;
     * - a THROWN `ToolExecutionError`, for a non-retryable failure or a user
     *   abort — the model gets the error, the task is left alone;
     * - `give-up`, when the retries (or the budget) ran out. The caller ends
     *   the remote task and reports; this is not an exception because it is a
     *   reportable outcome, not a broken call.
     */
    private pollWithRetry;
    /**
     * The single source of the poll loop's user-cancel error — every abort exit
     * (mid-sleep, mid-request, mid-elicitation) throws THIS, so the code can
     * never drift between them again.
     *
     * `ToolCancelledError`, not `A2ATimeoutError`: every caller checks
     * `abortSignal.aborted` before reaching here, so a cancel is what this
     * KNOWS happened — and a cancel coded as a timeout reads downstream as "the
     * remote was slow", which is a different incident with a different fix.
     * Matches the convention `glob-tool` and `ask-user-question-tool` already
     * follow for their own abort exits.
     *
     * `classifyA2AError` deliberately still folds `aborted` into
     * `A2ATimeoutError`: at the CLIENT layer a user cancel and the client's own
     * request timeout arrive with an identical message (see
     * `A2aClientService.withAbortAndClient`), so that layer genuinely cannot
     * tell them apart. This one can, which is exactly why it must say so.
     */
    private abortedError;
    /**
     * Error text for a failure the model has to act on itself.
     *
     * Leads with the HTTP status because that is what tells a 404 (wrong task
     * id — the model may have one from an earlier turn) apart from a 403
     * (this agent is not allowed here — retrying will never help), and
     * carries the remote's own response body, which is where an agent
     * normally puts the part a human can act on.
     */
    private formatRequestFailure;
    /**
     * A.2's live-progress relay — the SAME `session.inputSubject.next({...})`
     * shape the foreground Bash tool uses for its own streaming updates
     * (`bash-tool.ts`'s `updateToolResult()`), reusing the tool call's own
     * `callId` and a single `streamingResultId` held for the whole loop.
     * `providerData.toolResult.rawResponse.a2a` carries the FULL snapshot
     * (including `snapshot.raw`'s structured `parts`/`metadata`), not just
     * the derived text — required for a frontend that knows how to render a
     * structured interrupt payload (e.g. a WeCom `wecom_part_type: 'approval'`
     * card, see A.2) to have the data it needs.
     *
     * **Also pushes the SAME item to `session.combineSubject`** — traced
     * empirically (issue #99451 Phase 2 e2e work) that `inputSubject.next()`
     * alone, exactly as Bash's own `updateToolResult()` does it, never
     * reaches either transport's actual subscription: both
     * `stream-json-view.ts` and `acp-agent.ts` subscribe ONLY to
     * `session.combineSubject` (`{type: 'input', data: item}`), and nothing
     * bridges `inputSubject` into `combineSubject` except
     * `SessionManager.addHistory()`'s explicit dual-push for REAL history
     * items — which a live, ephemeral, non-terminal relay frame like this
     * one deliberately is not (it's never persisted to `session.history`).
     * Confirmed live: Bash's OWN in-progress streaming updates do NOT
     * currently reach stream-json `-p` output either (only its terminal
     * result does) — that's a pre-existing gap in `bash-tool.ts`, out of
     * scope to fix here, but exactly why this method can't just copy Bash's
     * `inputSubject`-only call and call it done: A.2's actual requirement is
     * multiple live relay frames on BOTH transports, so this pushes to both
     * subjects explicitly rather than reproducing that gap.
     */
    private relayProgress;
    /**
     * Raise an approval card for an out-of-band approval interrupt and turn
     * the user's answer into a poll-loop decision (issue #107183).
     *
     * No timeout is passed. `elicit()` cannot be told to wait forever anyway
     * (a `0`/absent `timeoutMs` falls back to its 10-minute default), and the
     * host already guarantees an answer arrives: sandbox-proxy synthesizes a
     * `cancel` response after 10 minutes of its own. So "wait for the host's
     * signal" needs no timeout code here — a host/CLI timeout simply shows up
     * as the `cancel` branch.
     */
    private handleApprovalInterrupt;
    /**
     * Model-facing result after a user ended a task from an approval card.
     *
     * Written as named sections — what was shown, what happened, and the
     * host's reason — rather than one prose paragraph, because the single
     * line that has to win was getting buried mid-sentence: this tool's own
     * `description` tells the model in MUST-level wording to immediately
     * re-poll any non-final result, so the text has to say plainly that
     * polling is over.
     *
     * Only counter-intuitive instructions are spelled out. Telling the user
     * the action did not happen is what a model does anyway; not re-polling,
     * closing an unconfirmed cancel out with `A2ACancelTask`, and reporting a
     * real terminal state instead of the refusal are the three it would
     * otherwise get wrong.
     *
     * When the cancel revealed the task was already terminal — commonly
     * because the approval was granted through the approving system's own UI
     * while our card sat open — the REAL state is reported through the
     * existing `formatTerminalContent()`, so a completed task is never
     * reported as a refusal.
     *
     * No agent id anywhere: it is the registry's routing key and is not
     * guaranteed to match the card's display name (see `A2aRegisteredAgent`),
     * while `taskId` alone already identifies the task uniquely.
     */
    private buildApprovalStopResult;
    /** Blank line between sections, reasons always last — see {@link appendApprovalResponseNotes}. */
    private composeSections;
    /**
     * Append host-supplied reasons as the LAST section of the result.
     *
     * The JSON encoding is the actual guard, not formatting: it collapses
     * newlines and heading-looking text into a single string literal, so a
     * reason cannot forge a section of its own. Keeping it last means no
     * instruction ever follows client-controlled text.
     *
     * A lone reason needs no action label — the section above it already said
     * what the user did. Several reasons only happen when one call raised more
     * than one card (accepting one approval, then declining another), and
     * there the labels are what keep two opposite answers apart.
     */
    private appendApprovalResponseNotes;
    /**
     * Make the terminal STATE explicit in the model-facing content.
     * `normalizeTask` derives the snapshot `text` from the task's
     * `status.message`/artifacts — which for a `canceled`/`failed`/`rejected`
     * task is frequently the remote agent's own progress narration (e.g.
     * "...正在发送 hello"), reading like success and causing the model to
     * misreport a non-success terminal task as done (issue #99451 follow-up:
     * observed a user-cancelled task reported back as "message sent"). Only
     * `completed` needs no prefix — its text IS the answer. The other three
     * terminal states are prefixed with an unmissable header so the model
     * cannot mistake the trailing narration for a success confirmation. The
     * raw state is still available in `rawResponse.a2a.status` for any
     * consumer that reads it structurally.
     */
    private formatTerminalContent;
    /**
     * The ordinary end of a poll: the task reached a terminal state, so wait
     * out its artifact downloads and hand the model the result.
     *
     * Shared with the stop path below, which lands here whenever a cancel
     * discovers the task had already finished. That sharing is the point —
     * a task that completed WITH attachments in the second before we tried to
     * cancel it must not lose them to a different, artifact-unaware code
     * path.
     *
     * Assumes its snapshot's downloads have already been kicked off; both
     * callers do that, the loop on every tick and the stop path for the
     * snapshot the cancel read back.
     */
    private buildTerminalResult;
    /**
     * End the remote task and tell the model what that actually did.
     *
     * Reached when the loop gives up on a task that never finished — the
     * budget ran out, or `tasks/get` kept failing. Both used to return "still
     * running, call me again", which read fine but left a real task running
     * on the remote agent for as long as it liked whenever the model decided
     * not to call back. Ending it here means the ceiling is enforced rather
     * than merely reported.
     *
     * The cancel is what produces the text, not a guess made before it:
     *
     * - `already-terminal` — the task crossed the finish line while we were
     *   canceling it, so there is nothing to narrate. It goes back through
     *   the normal terminal path and the model sees an ordinary result,
     *   artifacts and all.
     * - `canceled` — say so, and name the state the remote reported rather
     *   than assuming CANCELED; nothing in the spec pins `tasks/cancel` to
     *   one value.
     * - `unknown` — we could not confirm anything, so the model is told the
     *   task may still be running and pointed at `A2ACancelTask`.
     */
    private buildPollStoppedResult;
}
export {};
