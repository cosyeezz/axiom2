import { AbTestService } from '@genie/product';
import type { Logger } from '@genie/telemetry';
import { A2aDirectoryView, A2aDiscoveryReadyService, A2aRegisteredAgent } from '../a2a/a2a-protocol';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { ToolErrorCode } from './tool-error-codes';
/**
 * Shared guard rails for every model-facing A2A tool (issue #99451):
 * gate check (exposure + execution layer, per `ProductFeature.A2AOutbound`
 * doc comment), main-session-only restriction (recursive-delegation guard),
 * discovery readiness (issue #99451 follow-up: URL-based discovery is lazy,
 * so every tool must await it before touching the registry), and agent
 * lookup with a consistent "not registered" error. Centralized so
 * `A2ASendMessageTool` / `A2AGetTaskTool` / `A2ACancelTaskTool` can't drift
 * on wording or accidentally skip a layer.
 */
export declare function isSubSession(session: Session | undefined): boolean;
/**
 * Execution-layer guard run at the top of every A2A tool's `execute()`.
 * Throws a `ToolExecutionError` if the gate is off or the call originates
 * from a sub-agent/team session — this is the defense-in-depth re-check
 * beyond `isEnabled` (stale cached tool-call / history replay / resumed
 * session must not bypass a runtime kill-switch just because `isEnabled`
 * gated it once already).
 *
 * Also awaits `A2aDiscoveryReadyService.waitForDiscovery()` — the shared
 * freshness/single-flight gate for discovery (see that interface's doc comment
 * for why each tool does not manage caching independently). Optional/no-op
 * when the component isn't
 * assembled (e.g. a headless build without the A2A feature), matching this
 * function's existing tolerance for missing components via `hasRequiredComponents`.
 */
export declare function assertA2AToolAllowed(hasRequiredComponents: boolean, session: Session | undefined, abTestService: AbTestService | undefined, discoveryReadyService?: A2aDiscoveryReadyService, logger?: Pick<Logger, 'debug'>): Promise<void>;
/**
 * Look up an agent by its stable `agentId` — the sole addressing key for every
 * model-facing A2A tool (issue #114840). The id is a `${slug(name)}-${hash(url)}`
 * key derived at discovery (see `deriveA2aAgentId`), surfaced to the model in
 * `<available_A2A_agents>` and by `A2AGetAgentCard`, and copied verbatim into
 * the send/get/cancel tools the same way a `task_id` is. Exact match only:
 * distinct endpoints get distinct ids, so a lookup is never ambiguous. Throws a
 * consistent "not registered" error listing the available `name (id)` pairs so
 * the model can correct a mistyped id.
 */
export declare function requireA2AAgent(registry: A2aDirectoryView, agentId: string): A2aRegisteredAgent;
/** Classify a thrown A2aClientService error into the right ToolErrorCode by matching known message patterns (see a2a-client-service.ts's doc comment on why we match text rather than `instanceof` typed SDK errors — this SDK version's JSON-RPC transport doesn't reconstruct semantic error subclasses). */
export declare function classifyA2AError(err: unknown): {
    message: string;
    code: ToolErrorCode;
};
