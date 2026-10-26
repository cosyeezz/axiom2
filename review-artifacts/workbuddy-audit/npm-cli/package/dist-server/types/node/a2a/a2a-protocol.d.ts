/**
 * Outbound A2A (Agent2Agent) protocol surface — CloudAgent Phase 1.
 *
 * Scope (see issue #99451): agent-cli acts ONLY as an outbound A2A client /
 * orchestrator. It discovers Agent Cards from a discovery URL supplied via
 * the `CODEBUDDY_REMOTE_AGENTS_URL` env var (see `a2a-gate.ts`) and invokes
 * them via the official `@a2a-js/sdk`. There is no agent-cli A2A server, no
 * remote-agent callback, and no A2A streaming (`sendMessageStream`/
 * `subscribeToTask`) in Phase 1 — `sendMessage` always returns immediately
 * with whatever the initial response is, and `A2AGetTaskTool` owns a
 * bounded poll loop for non-terminal tasks (see that tool's doc comment).
 *
 * Discovery uses one shared readiness gate (`A2aDiscoveryReadyService`):
 * startup starts a non-blocking fetch, first dispatch can wait briefly for it,
 * and every A2A tool execution checks whether the last successful result is
 * still fresh. The first stale caller refreshes while concurrent callers join
 * the same request. The discovery URL and TTL are read live from `process.env`
 * per this repo's prewarm convention (see `CODEBUDDY.md` §1.1's "env 消费同理"
 * section), after a standby process receives its per-session environment.
 *
 * State was originally process-global only (like `SdkInitializeStateService`),
 * premised on CloudAgent's spawn topology — one agent-cli process per
 * conversation via `@genie/agent-sdk-js` stream-json (WORKBUDDY-TROUBLESHOOTING.md
 * Step 0.5), where one process-global discovery source is active at a time.
 * The served (`/server`) multi-session topology broke that premise, so the
 * directory now has a session dimension (the `AgentScopedMcpManager` side of
 * the old contrast): `QueryOptions.remoteAgentsUrl` gives a session its own
 * discovery source, resolved per source into registry partitions
 * (`A2aAgentRegistry.resolveView`) with per-source single-flight/TTL
 * (`A2aDiscoveryReadyService.waitForDiscovery(session)`). Sessions without a
 * seat keep the process-global path byte-for-byte (bin/spawn unaffected);
 * changing the live env URL still invalidates the process result.
 *
 * All Symbols/interfaces live here per the repo's `xxx-protocol.ts` convention
 * (Symbol + interface; implementations live in sibling files).
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { W3CTraceContextMeta } from '@genie/telemetry';
export declare const A2aAgentRegistry: unique symbol;
export declare const A2aClientService: unique symbol;
export declare const A2aAgentDiscoveryService: unique symbol;
export declare const A2aDiscoveryReadyService: unique symbol;
export declare const A2aArtifactDownloadService: unique symbol;
/**
 * Internal input shape for `A2aAgentRegistry.register()` — NOT part of the
 * wire protocol (see module doc comment: the host only supplies a discovery
 * URL now, not this shape directly). `A2aAgentDiscoveryService` maps each
 * fetched raw `AgentCard` into one of these, deriving `agentId` via
 * `deriveA2aAgentId` (a `${slug(name)}-${shortHash(canonicalUrl)}` key that is
 * stable per endpoint — see issue #114840). No per-agent auth: the discovery URL (and every
 * discovered agent's own calls, via the same proxy path) is routed through
 * our own infrastructure, which handles auth uniformly (issue #99451 Part
 * B) — see `A2aAgentDiscoveryService`'s doc comment.
 */
export interface A2AAgentDefinition {
    agentId: string;
    agentCard: Record<string, unknown>;
}
/**
 * URI of the private codebuddy.ai extension that lets a caller pin a
 * `SendMessage` at one specific declared skill (`@Agent.Skill` routing).
 * Only agents whose card declares this URI in `capabilities.extensions`
 * honor `skillId` in `A2aClientService.sendMessage`; other agents receive no
 * skill targeting (routed through the agent's own intent dispatch instead).
 * Lives here (not in `a2a-client-service.ts`) so pure discovery code
 * (`A2AGetAgentCardTool`) can check support without importing `@a2a-js/sdk`.
 */
export declare const SKILL_ROUTING_EXTENSION_URI = "https://codebuddy.ai/a2a/extensions/skill-routing";
/** Whether `agentCard.capabilities.extensions` declares {@link SKILL_ROUTING_EXTENSION_URI}. */
export declare function cardSupportsSkillRouting(card: A2aAgentCard): boolean;
/**
 * A single Agent Card entry as indexed by the registry, keyed by the derived
 * `agentId` (`deriveA2aAgentId` — `${slug(name)}-${hash(url)}`, NOT the card's
 * own `name`; the id is the stable, unique routing key and may share a slug
 * prefix with another agent's while staying distinct via the hash).
 */
export interface A2aRegisteredAgent {
    agentId: string;
    agentCard: A2aAgentCard;
}
/**
 * Minimal shape of an A2A v1.0 AgentCard this registry actually reads.
 * Intentionally narrower than the full `@a2a-js/sdk` `AgentCard` type — the
 * registry only validates/indexes the fields it needs (name/description/
 * skills/interfaces); the full card is handed to `ClientFactory.createFromAgentCard`
 * verbatim when a call is made, so no information is lost.
 */
export interface A2aAgentCard {
    name: string;
    description?: string;
    skills?: A2aAgentSkill[];
    supportedInterfaces?: A2aAgentInterface[];
    capabilities?: {
        streaming?: boolean;
        extensions?: Array<{
            uri?: string;
        }>;
    };
    [key: string]: unknown;
}
export interface A2aAgentSkill {
    id: string;
    name?: string;
    description?: string;
    tags?: string[];
    examples?: string[];
    [key: string]: unknown;
}
export interface A2aAgentInterface {
    url: string;
    protocolBinding?: string;
    protocolVersion?: string;
    tenant?: string;
    [key: string]: unknown;
}
/** Validation outcome for a single incoming `A2AAgentDefinition`. */
export interface A2aRegistrationIssue {
    agentId: string;
    reason: string;
}
/**
 * Read face of one agent directory — the process directory (the registry
 * itself) or one session-source partition (`A2aAgentRegistry.resolveView`).
 * Everything that only LOOKS AGENTS UP (tool guards, description rendering,
 * fingerprinting, the client's id→agent resolution) consumes this shape, so
 * it stays source-agnostic.
 */
export interface A2aDirectoryView {
    /** All currently registered agents, or an empty array if none. */
    list(): A2aRegisteredAgent[];
    /** A single agent by `agentId`, or `undefined`. */
    get(agentId: string): A2aRegisteredAgent | undefined;
    /**
     * Look up a skill by ID on a specific agent. Returns `undefined` when the
     * agent doesn't exist OR the agent's card doesn't declare that skill —
     * callers must distinguish "agent not found" from "skill not found" via
     * a separate `get()` call when producing an error message.
     */
    getSkill(agentId: string, skillId: string): A2aAgentSkill | undefined;
}
export interface A2aAgentRegistry extends A2aDirectoryView {
    /**
     * Atomically replace the full set of authorized agents **of the process
     * (env) source**. Invalid entries (duplicate `agentId`, missing
     * name/skills, malformed interface) are dropped and reported in `issues`;
     * valid entries are still registered. A no-op call (`definitions`
     * undefined/empty) clears the registry.
     */
    register(definitions: A2AAgentDefinition[] | undefined): {
        registered: string[];
        issues: A2aRegistrationIssue[];
    };
    /**
     * Atomically replace one **session-source partition** (keyed by its
     * discovery URL; sessions sharing a URL share the partition and its
     * fetch). Validation is identical to `register()`. Deliberately does NOT
     * fire `setOnAgentsChanged` — that listener drives the process-face
     * repaint (invalidate + refresh every agent), which per-session data must
     * never trigger; session partitions surface through the session-agent-view
     * directory fingerprint instead (self-sufficient invalidation).
     */
    registerForSource(sourceUrl: string, definitions: A2AAgentDefinition[] | undefined): {
        registered: string[];
        issues: A2aRegistrationIssue[];
    };
    /**
     * Resolve the directory a session actually sees: its session source's
     * partition when `QueryOptions.remoteAgentsUrl` set one (an empty seat
     * — `''` — resolves to an empty directory), else the process directory.
     * A session source equal to the live process env URL shares the process
     * directory (and its reactive repaint chain) instead of a duplicate
     * partition. Pure lookup — never triggers a fetch.
     */
    resolveView(session?: Session): A2aDirectoryView;
    /** Clear all registered agents of the process source (test/process-teardown use). */
    clear(): void;
    /**
     * Register a single listener invoked whenever the registered set changes
     * via `register()` (including a clear to the empty set). Used by
     * `ToolManager` to reactively rebuild the `A2AGetAgentCard` tool
     * description's `<available_A2A_agents>` block after discovery or refresh
     * completes (mirrors `DelegateToolManager.setOnToolsChanged`). At most one
     * listener; a later call replaces the prior one. The listener may be sync or async;
     * `register()` isolates both a synchronous throw and a post-`await`
     * rejection so a bad consumer cannot corrupt the atomic registry swap.
     */
    setOnAgentsChanged(listener: () => void | Promise<void>): void;
}
/**
 * Outcome of a single {@link A2aAgentDiscoveryService.discover} call.
 *
 * `ok: true` — the discovery source was reached and parsed, so the registry
 * authoritatively reflects it, EVEN IF that means zero agents. A well-formed
 * empty result is a success, not a failure. When there is no source URL, the
 * call is also successful but leaves the inaccessible registry unchanged.
 *
 * `ok: false` — the fetch/parse failed transiently, or its result became
 * obsolete before publication because the source/reset generation changed.
 * The current flight clears the registry and retries on a later invocation;
 * an obsolete flight is discarded while its waiter continues immediately
 * against the current generation. This stops the single-flight gate from
 * permanently latching a transient startup failure (issue #99451 follow-up).
 */
export interface A2aDiscoveryOutcome {
    ok: boolean;
}
/**
 * Fetches the outbound agent list from a host-supplied discovery URL and
 * feeds it into `A2aAgentRegistry`. This service owns the actual `fetch()` +
 * parse + map + register pipeline; `A2aDiscoveryReadyService` owns startup,
 * freshness, and single-flight scheduling.
 */
export interface A2aAgentDiscoveryService {
    /**
     * Fetch `CODEBUDDY_REMOTE_AGENTS_URL` (read live from `process.env` at
     * call time — see module doc comment on why this must never be cached
     * earlier), parse the response as a JSON array of A2A v1.0 `AgentCard`
     * objects, map each into an `A2AAgentDefinition` (`agentId` derived via
     * `deriveA2aAgentId` — a stable per-endpoint key, see issue #114840), and register the result via
     * `A2aAgentRegistry.register()`. Always performs a fresh fetch when
     * called — caching/dedup against repeated calls is `A2aDiscoveryReadyService`'s
     * job, not this service's.
     *
     * Never throws: a failed fetch/parse logs, clears the registry when the
     * attempt is still current, and resolves with `{ ok: false }` so the gate
     * can retry later. Obsolete attempts do not publish. A completed fetch
     * (including a legitimately empty agent list) and the
     * no-source case both resolve with `{ ok: true }`. See
     * {@link A2aDiscoveryOutcome}.
     *
     * No-op (`{ ok: true }`, resolves immediately) when the env var is
     * unset/empty and the local test override is off.
     */
    discover(options?: {
        signal?: AbortSignal;
        /** Return false when an obsolete in-flight result must not replace the registry. */
        shouldApply?: () => boolean;
    }): Promise<A2aDiscoveryOutcome>;
    /**
     * Fetch ONE session-source discovery URL and publish the result into that
     * source's registry partition (`A2aAgentRegistry.registerForSource`).
     * Same fetch/parse/map pipeline as `discover()`, two deliberate
     * divergences: a failed fetch/parse leaves the existing partition
     * untouched (a transient blip must not wipe a tenant's working directory
     * mid-conversation; freshness is not latched so a later call retries),
     * and no registry-change notification fires (see `registerForSource`).
     */
    discoverSource(sourceUrl: string, options?: {
        signal?: AbortSignal;
    }): Promise<A2aDiscoveryOutcome>;
}
/**
 * Shared readiness gate that caches a successful discovery for a bounded TTL.
 * The first caller with no fresh result starts a fetch and concurrent callers
 * await the same in-flight promise. The state machine is deliberately NOT
 * duplicated per tool, so all four A2A tools share freshness, retry, URL-change,
 * and concurrency behavior.
 */
export interface A2aDiscoveryReadyService {
    /**
     * Explicitly start the gated discovery single-flight without awaiting it.
     * Activation/reconfiguration callers use this after the final A2A source
     * has landed so discovery overlaps the remaining startup work. A later
     * first prompt joins the same flight through {@link prewarmForFirstRun}.
     */
    startDiscoveryInBackground(session?: Session): void;
    /**
     * Return immediately while the last successful discovery is fresh;
     * otherwise start or join one refresh and await it. Safe to call from
     * every A2A tool's guard. With `session`, resolves that session's
     * discovery source first (see `resolveRemoteAgentsUrl`): a session source
     * waits on its own per-URL single-flight/TTL slot; sessions without one
     * (or whose source equals the live env URL) take the process path.
     */
    waitForDiscovery(session?: Session): Promise<void>;
    /**
     * Gated + bounded first-run warm-up for the description path (issue
     * #99451 Part B follow-up). Called once from the first model dispatch
     * (`AgentManager.ensureAgentToolsFreshForRun`) so a fast discovery can
     * land before the first request is built, making the `A2AGetAgentCard`
     * description's `<available_A2A_agents>` block non-empty on turn 1
     * (otherwise the model would have no signal these agents exist and would
     * skip delegation on its first turn).
     *
     * Contract:
     * - **Gated**: resolves `false` fast when outbound A2A is off
     *   (`CODEBUDDY_REMOTE_AGENTS_URL` unset short-circuits before any
     *   `AbTestService` round trip), so non-A2A products pay nothing.
     * - **Bounded**: when enabled, triggers `waitForDiscovery()` (single-flight,
     *   shared with execute-time freshness checks — never a concurrent second
     *   fetch for the same URL/generation) and awaits it only up to `timeoutMs`
     *   (env `CODEBUDDY_A2A_DISCOVERY_PREWAIT_MS`,
     *   default 2000; `0` disables the wait). Times out / aborts silently —
     *   the reactive registry refresh remains the fallback for slow fetches.
     * - Returns `true` when outbound A2A is enabled (the caller should then
     *   refresh the dispatching agent's tools so the first request carries the
     *   discovered list), `false` otherwise.
     */
    prewarmForFirstRun(options?: {
        timeoutMs?: number;
        signal?: AbortSignal;
        session?: Session;
    }): Promise<boolean>;
    /**
     * Invalidate successful freshness so the next `waitForDiscovery()` starts
     * a new generation. An active obsolete request is aborted and guarded from
     * publishing over the new generation.
     */
    reset(): void;
}
/**
 * A single file reference the caller attaches to an outbound `A2ASendMessage`
 * call. Mapped 1:1 onto an A2A `url` file `Part` (`$case: 'url'`) on the
 * message the remote agent receives. The counterpart of `A2aArtifactSummary`
 * for the inbound direction, but kept a separate type on purpose: this is a
 * message *input* (an A2A file `Part`, whose file-name field is `filename`),
 * whereas `A2aArtifactSummary` describes a task *output* artifact (whose
 * name field is `name`).
 */
export interface A2aOutboundAttachment {
    /** A fetchable URL the remote agent can retrieve the file from. Required. */
    url: string;
    /** Optional display filename for the file part (A2A `Part.filename`, e.g. "report.pdf"). */
    filename?: string;
    /** Optional MIME type for the file part (A2A `Part.mediaType`, e.g. "application/pdf"). */
    mediaType?: string;
}
/**
 * Outbound A2A message result normalized for tool consumption. Distinct from
 * the raw `@a2a-js/sdk` `Message | Task` union so `A2aClientService` callers
 * (the tools) don't need to know SDK wire shapes.
 */
export interface A2aSendMessageResult {
    /** Human-readable text to place in `ToolResult.content`. Always non-empty. */
    text: string;
    /** `'message'` when the agent returned a direct Message; `'task'` otherwise. */
    kind: 'message' | 'task';
    /** Present only when `kind === 'task'`. */
    taskId?: string;
    /** Present only when `kind === 'task'`. Reusable for follow-up turns targeting the same (agentId, skillId). */
    contextId?: string;
    /** Task-state derived status, aligned with A2aTaskStatus below. Absent for direct-message results. */
    status?: A2aTaskStatus;
    /** Populated when status === 'input-required' or 'auth-required'. */
    clarification?: {
        question: string;
    };
    /** File/data references extracted from artifacts, if any (URL-preferred; no inline blobs). */
    artifacts?: A2aArtifactSummary[];
    /** Raw SDK response, retained for `ToolResult.rawResponse` (diagnostics only, never shown raw to the model). */
    raw: unknown;
}
export type A2aTaskStatus = 'submitted' | 'working' | 'completed' | 'failed' | 'canceled' | 'rejected' | 'input-required' | 'auth-required'
/**
 * The wire's `TASK_STATE_UNSPECIFIED` (a legal, spec-defined "unknown or
 * indeterminate state" per the A2A `TaskState` enum) or an enum value this
 * SDK version doesn't recognize yet (`TaskState.UNRECOGNIZED`) — NOT an
 * agent-cli-side error. Non-terminal: `A2AGetTaskTool` keeps polling
 * through it exactly like `submitted`/`working`, on the theory that a
 * spec-compliant remote agent reporting this will eventually resolve to a
 * real state.
 */
 | 'unknown';
export interface A2aArtifactSummary {
    /** Original filename declared by the URL part, when supplied. */
    filename?: string;
    name?: string;
    mediaType?: string;
    /** URL/file reference when the part carries one; omitted for inline text/data parts (those are folded into `text`). */
    url?: string;
    /**
     * Local filesystem path a URL artifact was downloaded to (see
     * `A2aArtifactDownloadService`), if the download completed in time.
     * Additive only — `url`/`name`/`mediaType` are never modified by the
     * download pipeline, so a frontend that doesn't know this field yet
     * keeps rendering exactly as it does today (issue #99451 artifact
     * download design doc §4's "前端字段仅新增不修改").
     */
    localPath?: string;
}
/**
 * Result of `A2aClientService.getTask` / `cancelTask` — a point-in-time
 * snapshot of a remote task, normalized the same way as
 * `A2aSendMessageResult`'s task branch (shared `text`/`status`/`clarification`/
 * `artifacts` shape) so tool implementations can reuse one renderer for
 * "the task result text" regardless of which A2A method produced it.
 */
export interface A2aTaskSnapshot {
    text: string;
    taskId: string;
    contextId?: string;
    status: A2aTaskStatus;
    clarification?: {
        question: string;
    };
    artifacts?: A2aArtifactSummary[];
    /**
     * Structured payload of an out-of-band **approval** interrupt, when the
     * task's `status.message` carries one (issue #107183). Populated by
     * `normalizeTask` purely by part SHAPE — a `data` part whose value has an
     * array `token_id_list` — never by a vendor `metadata` field, matching
     * `renderStatusMessageParts`'s existing convention.
     *
     * Pre-derived here rather than left for callers to dig out of `raw`
     * (typed `unknown`): `A2AGetTaskTool` keys its elicitation branch off
     * this, and hosts that render the approval card read the same field out
     * of `rawResponse.a2a` instead of re-implementing the shape match.
     */
    approval?: A2aApprovalInterrupt;
    raw: unknown;
}
/**
 * An approval interrupt extracted from a task's `status.message.parts`
 * (issue #107183). `tokenIds` are opaque handles the HOST (not agent-cli)
 * submits to the approving system out of band — agent-cli only transports
 * them, it never interprets or submits them itself. `parts` keeps the
 * verbatim source parts so a host can render richer detail than the ids.
 */
export interface A2aApprovalInterrupt {
    tokenIds: unknown[];
    parts: unknown;
}
/**
 * Thin wrapper around `@a2a-js/sdk`'s `ClientFactory` + `Client`. Reuses the
 * negotiated transport while callers resolve to the same registry entry; a
 * discovery refresh replaces that entry and therefore creates a new client.
 * `sendMessage`/`getTask`/
 * `cancelTask` are each a single RPC call — whatever status the remote agent
 * returns (terminal or not) is returned as-is, unmodified; no polling loop
 * and no `sendMessageStream`/`subscribeToTask` live here (issue #99451 Phase
 * 2: the poll loop for a non-terminal task lives exclusively in
 * `A2AGetTaskTool`, one layer up — see that tool's doc comment).
 */
export interface A2aClientService {
    /**
     * Send a message to `agent` (a directory-resolved entry — the caller
     * resolves names/ids in ITS directory via `A2aAgentRegistry.resolveView`;
     * this layer never looks agents up) — optionally targeting `skillId` — and
     * return whatever the single `message/send` RPC call gets back —
     * terminal, `working`, `input-required`, anything — unmodified.
     * `contextId`/`taskId` are supplied by the caller to continue a prior
     * turn; omit both to start a new task/context.
     */
    sendMessage(agent: A2aRegisteredAgent, params: {
        text: string;
        skillId?: string;
        contextId?: string;
        taskId?: string;
        /**
         * Optional file references to attach to the outbound message.
         * Each becomes a standard A2A `url` file `Part` (`FileWithUri`
         * semantics — `$case: 'url'`) appended after the text part, so the
         * remote agent can fetch the file itself. Purely generic to A2A:
         * the URL's origin (e.g. a host-side upload skill that returns a
         * fetchable link) is out of scope here — this layer only knows how
         * to put a URL on the wire as a file part.
         */
        attachments?: A2aOutboundAttachment[];
        traceContext?: Readonly<W3CTraceContextMeta>;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<A2aSendMessageResult>;
    /**
     * Retrieve the current state of a previously created task on `agent`.
     * Used to reconcile an interrupted (`input-required`/`auth-required`) or
     * asynchronously-progressing task without sending a new message — e.g.
     * after a `sendMessage` call whose result the caller didn't immediately
     * act on, or to check on a task the remote agent is still working on.
     */
    getTask(agent: A2aRegisteredAgent, params: {
        taskId: string;
        traceContext?: Readonly<W3CTraceContextMeta>;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<A2aTaskSnapshot>;
    /**
     * Request cancellation of a previously created task on `agent`.
     * Cancellation is an attempt, not a guarantee — per the A2A spec, an
     * already-terminal task is not cancelable (`TaskNotCancelableError`) and
     * an unknown task id is `TaskNotFoundError`; both surface as thrown
     * errors for the tool layer to translate into a specific error code
     * rather than silently reporting success.
     */
    cancelTask(agent: A2aRegisteredAgent, params: {
        taskId: string;
        traceContext?: Readonly<W3CTraceContextMeta>;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<A2aTaskSnapshot>;
    /** Drop all cached clients (test/process-teardown use). */
    clear(): void;
}
/** Outcome of a single tracked download — see `A2aArtifactDownloadService.getResult`. */
export type A2aArtifactDownloadStatus = 'pending' | 'done' | 'failed';
/**
 * Fire-and-forget downloader for URL-referenced A2A artifacts (issue
 * #99451). It is a local convenience so the model can act on a downloaded
 * file (for example via `Read`) instead of receiving only a bare URL.
 *
 * The component is process-scoped, but records and URL deduplication are
 * scoped to one Session. Each download captures that Session's resolved
 * sandbox/cwd and writes under a session-keyed output path. Failures,
 * timeouts, and oversized responses surface only through
 * `getResult()` as `status: 'failed'`.
 */
export interface A2aArtifactDownloadService {
    /**
     * Start downloading one artifact into `session`'s workspace, unless its
     * URL is already tracked for that Session. Returns immediately and never
     * throws. The independent download kill switch makes this a no-op.
     */
    startDownload(session: Session, artifact: A2aArtifactSummary): void;
    /** Current state of `url` for this Session. Does not trigger a download. */
    getResult(session: Session, url: string): {
        status: A2aArtifactDownloadStatus;
        localPath?: string;
        error?: string;
    } | undefined;
    /**
     * Wait up to `timeoutMs` for this Session's tracked `urls` to settle,
     * then return without rejecting. Used only immediately before a terminal
     * tool result, never on the live polling relay path.
     */
    awaitPending(session: Session, urls: string[], timeoutMs: number): Promise<void>;
}
