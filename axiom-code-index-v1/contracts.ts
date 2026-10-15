/** Target contracts for the implementation plan. NOT existing Axiom exports.
 * This review bundle contains domain DTOs and deliberately narrow local ports.
 * Production separates browser-safe DTOs, private IPC schemas and local ports;
 * it must implement strict runtime schemas and permission checks. SDK objects,
 * SQL handles, AbortSignal and callbacks never cross the wire. Local ports may
 * accept signals/callbacks; pi 1.1.0 types stay in the pi adapter.
 */
import type { Selection as ModelSelection } from "../app/src/shared/agent.js";

export type Id = string;
export type ObjectKind = "symbol" | "module" | "implementation" | "feature" | "knowledge" | "edge";
export type SemanticKind = Exclude<ObjectKind, "symbol" | "edge">;
export type Freshness = "current" | "stale" | "unresolved"; // access denial is separate; denied records are omitted
export type LocateStatus = "ok" | "partial" | "not_found" | "error";
export type Mode = "off" | "observe" | "assist" | "native";
export type RunPurpose = "locate" | "bootstrap" | "maintain" | "import_review";
export type JobPurpose = Exclude<RunPurpose, "locate">;
export type Relation = "contains" | "uses" | "code" | "test" | "relates" | "applies_to" | "contradicts";
export type LocationRole = "primary" | "entry" | "guard" | "contract" | "test";
export type ErrorCode = "DISABLED" | "NOT_READY" | "INVALID_INPUT" | "ACCESS_DENIED" |
  "FILE_CHANGED" | "WORKSPACE_CHANGED" | "RECORD_CHANGED" | "INVALID_PROPOSAL" |
  "AMBIGUOUS_REUSE" | "BUDGET_EXCEEDED" | "CANCELLED" | "MODEL_UNAVAILABLE" |
  "STORE_BUSY" | "STORE_FAILED" | "UNSUPPORTED_SCHEMA" | "SNAPSHOT_EXPIRED";

/** Zero-based, half-open range; stored and exchanged in UTF-16 code units. */
export interface SourceRef {
  id: Id;
  workspaceId: Id;
  path: string;
  contentHash: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
    encoding: "utf-16";
  };
}
export interface ScopeDefinition {
  include: string[]; // normalized workspace-relative globs, intersected with FilePolicy
  exclude: string[];
}
/** Issued by the evidence service; referenced records become durable on commit. */
export type EvidenceRecord =
  | { id: Id; kind: "source_range"; sourceRefId: Id }
  | {
      id: Id;
      kind: "scope_observation";
      scopeId: Id;
      definition: ScopeDefinition;
      definitionHash: string;
      contentDigest: string;
      policyHash: string;
      analysisContextHash: string;
      operation: "search" | "changes" | "manifest";
      query: { text: string; caseSensitive: boolean } | null;
      complete: boolean;
      observation: string; // service-generated observation, not an inferred behavior
    };
export interface Coverage {
  mode: "partial" | "reviewed_scope";
  scopeIds: Id[];
  gaps: { code: string; description: string; scopeId?: Id }[];
}
/** Issued by the service. The model cannot assert basis versions or freshness. */
export interface ReadToken {
  workspaceId: Id;
  observedEpoch: number;
  semanticEpoch: number;
  policyHash: string;
  analysisContextHash: string;
  ledgerId: Id;
  consistency: "verified_basis" | "unresolved";
}
export interface EvidenceClaim {
  kind: "responsibility" | "trigger" | "condition" | "action" | "result" |
    "contract" | "constraint" | "decision";
  assertion: "observed" | "specified";
  text: string;
  evidenceIds: Id[];
}
/** Source-backed conditional ordering between two uses occurrences of one feature.
 * A shared implementation in different slots remains different flow steps.
 * Text conditions do not prove exclusivity, completeness, join or return semantics.
 */
export interface FlowAssertion {
  beforeEdgeId: Id;
  afterEdgeId: Id;
  condition: string;
  evidenceIds: Id[];
}
interface NodeBase {
  id: Id; // durable ID or request-local tmp_*; create requires expectedContentRev=null
  expectedContentRev: number | null;
  expectedRecordRev: number | null; // CAS for body/review/lifecycle; both null on create
  name: string;
  summary: string;
  aliases: string[];
  facts: EvidenceClaim[];
  boundary: { includes: string; excludes: string[] };
  unknowns: string[];
  coverage: Coverage;
}
export type NodeProposal =
  | (NodeBase & { kind: "module"; scopeIds: Id[] })
  | (NodeBase & { kind: "implementation" })
  | (NodeBase & { kind: "feature"; flows: FlowAssertion[] })
  | (NodeBase & {
      kind: "knowledge";
      knowledgeType: "contract" | "constraint" | "decision";
      assertion: "observed" | "specified";
      rationale: string | null; // unknown rationale stays null, never inferred history
      authoritySourceIds: Id[]; // source references; these do not grant tool permissions
    });
export interface EdgeProposal {
  id: Id;
  expectedContentRev: number | null;
  expectedRecordRev: number | null;
  fromId: Id;
  target: { objectId: Id } | { sourceRefId: Id };
  relation: Relation;
  slot: string;
  role?: LocationRole;
  reason: string;
  evidenceIds: Id[];
}
export interface ResultSelection {
  objectIds: Id[];
  locations: { sourceRefId: Id; symbolId?: Id; role: LocationRole; reason: string }[];
  featurePaths: Id[][];
  knowledgeIds: Id[];
}
export interface IndexProposal {
  version: "index-proposal/1";
  requestId: Id; // must equal the attempt-bound request; never selects or overrides ownership
  /** Mutation IDs are unique across arrays, except body update + reactivate of
   * one retired record with identical preimage CAS; apply as one recordRev change. */
  nodes: NodeProposal[];
  edges: EdgeProposal[];
  /** Review unchanged records without rewriting semantic content. */
  reviews: { id: Id; expectedContentRev: number; expectedRecordRev: number; evidenceIds: Id[]; scopeIds: Id[] }[];
  /** Explicit lifecycle changes; omission never deletes or reactivates a record. */
  retire: { id: Id; expectedContentRev: number; expectedRecordRev: number; reason: string; evidenceIds: Id[] }[];
  reactivate: { id: Id; expectedContentRev: number; expectedRecordRev: number; reason: string; evidenceIds: Id[] }[];
  result: {
    status: Exclude<LocateStatus, "error">;
    selection: ResultSelection;
    searchedScopeIds: Id[];
    coverage: Coverage;
  };
}
export interface LocateInput {
  query: string;
  hints?: { paths?: string[]; symbols?: string[] };
  /** Only follows a service-issued cursor for the exact same query/hints. */
  cursor?: string;
}
export interface LocateResult {
  status: LocateStatus;
  query: string;
  maintained: boolean; // validated committed records; no-op/direct paths may be true
  freshness: Freshness;
  readToken: ReadToken | null;
  locations: { symbolId?: Id; sourceRef: SourceRef; role: LocationRole; reason: string; freshness: Freshness }[];
  selectedObjectIds: Id[];
  featurePaths: { id: Id; name: string }[][];
  knowledge: {
    id: Id;
    name: string;
    assertion: "observed" | "specified";
    summary: string;
    freshness: Freshness;
    sourceRefs: SourceRef[];
  }[];
  coverage: Coverage;
  searchedScopeIds: Id[];
  nextCursor?: string;
  error?: { code: ErrorCode; retryable: boolean; message: string };
}
/** Host-observed execution facts, never a model-authored progress report.
 * IPC supplies the complete owner/call/admission identity. Counts cover this
 * logical request, including retries; sequence never resets across attempts.
 */
export interface IndexProgress {
  version: 1;
  requestId: Id;
  attemptId: Id | null; // null before attempt admission or on a direct path
  sequence: number;
  phase: "queued" | "querying" | "reading" | "analyzing" | "validating" |
    "committing" | "completed" | "failed" | "cancelled" | "interrupted";
  elapsedMs: number;
  modelRequestsStarted: number;
  evidencePages: number;
}
/** Observers are isolated from execution; rejection cannot prevent commit/cleanup. */
export type IndexProgressObserver = (progress: IndexProgress) => void | Promise<void>;
/** Live onUpdate payload only. Final tool results must use IndexToolDetails. */
export interface IndexToolProgressDetails {
  axiomIndexProgress: IndexProgress;
}
/** Target optional fields on tool IPC events and ChatMessage tool-result projections.
 * Extract only trusted axiomIndexProgress after owner/sequence validation. Preserve
 * call order, never use thinking, and recover history only from final tool details.
 */
export interface IndexToolMessageFields {
  toolProgress?: IndexProgress;
}
export interface ObjectRevision {
  id: Id;
  contentRev: number;
  recordRev: number;
}
export interface BasisItem {
  kind: "file" | "scope" | "object" | "context";
  key: string;
  version: string; // object: contentRev; active state and effective freshness are checked transitively
}
export interface OverviewRequest {
  scopeIds?: Id[]; // host-provided, no arbitrary filesystem roots
  cursor?: string;
}
export interface OverviewPackage {
  packageId: Id;
  workspaceId: Id;
  snapshotId: Id;
  semanticEpoch: number;
  policyHash: string;
  rendererVersion: string;
  bodyHash: string;
  text: string;
  objectIds: Id[];
  objectRevisions: ObjectRevision[];
  coverage: Coverage;
  freshness: Freshness;
  nextCursor?: string;
}
/** Native identity and separate SHA-256/JCS hashes; no entry/message bodies.
 * sourceHash covers the entry's canonical JSON persistence form; projectedHash
 * covers its effective projected messages. The encoding/projection version is
 * bound by selectorVersion. Equal source hashes do not rule out context edits.
 */
export interface ContextEntryStamp {
  entryId: Id;
  sourceHash: string;
  projectedHash: string;
}
/** References only; raw user text, tool output and inferred intent are not stored.
 * entryId is pi's native SessionEntry.id, never a UI message/input receipt ID.
 * For a tool signal, the top-level stamp binds the result and call binds the
 * assistant entry containing the raw toolCallId (not its run-qualified UI key).
 * Both entries must pair uniquely and have no targeting context_edit on the full
 * current branch. Trusted adapters must confirm success; errors, unknown results
 * and synthetic axiomInterrupted placeholders are not successful file access.
 */
export type ContextFocusSignal = ContextEntryStamp & (
  | { kind: "user_input" }
  | { kind: "index_tool" | "file_tool"; toolCallId: Id; call: ContextEntryStamp }
);
export type ContextSelectionReason = "workspace_overview" | "workspace_constraint" |
  "explicit_object" | "path_or_symbol" | "query_terms" | "graph_neighbor" |
  "applicable_knowledge" | "conflict";
/** Reusable candidate hints, not proof that old context/knowledge remains valid.
 * Selection reads effective projection messages. Recovery checks owner, the full
 * current branch (including compacted edits), latest consumed input, both stamps,
 * source/policy and selector version. A later omitted input still bars an old task.
 */
export interface ContextFocusSnapshot {
  version: 1;
  selectorVersion: string;
  branchLeafId: Id | null; // snapshot position, not a stable branch ID; ordinary appends advance it
  latestConsumedInputEntryId: Id | null; // includes a consumed input later omitted by context_edit
  userAnchorEntryId: Id | null; // if non-null, equals latest input and has a user_input signal
  signals: ContextFocusSignal[]; // at most 8 tool calls, including recovered hints; result-entry order
  selections: {
    objectId: Id;
    reasons: ContextSelectionReason[];
    signalEntryIds: Id[]; // empty only for workspace-wide overview/constraints
  }[];
}
/** Metadata only: neither a second conversation history nor proof of understanding. */
export interface ContextDelivery {
  deliveryId: Id;
  modelRequestId: Id | null; // required for included; prepared may precede a provider call
  indexKey: Id;
  workspaceId: Id;
  policyHash: string;
  sessionId: Id;
  runId: Id;
  contextGeneration: string; // worker incarnation + active branch/compaction identity
  focus: ContextFocusSnapshot;
  packageId: Id;
  bodyHash: string;
  objectRevisions: ObjectRevision[];
  scopeIds: Id[];
  state: "prepared" | "included" | "obsolete";
}
export interface MaintenanceJob {
  id: Id;
  groupId: Id | null; // bootstrap/import aggregate budget, not reset by a new batch
  indexKey: Id; // worker, author lock, coalescing and maintenance budget share this key
  ownerWorkspaceId: Id | null; // an authorized entry selected for this execution, not pool identity
  originRunIds: Id[];
  purpose: JobPurpose;
  scopeIds: Id[];
  eventHighWatermark: number; // zero when no change events belong to this batch
  inputDigest: string;
  state: "pending" | "running" | "done" | "blocked" | "cancelled" | "interrupted";
  reason: string | null;
  attempt: number;
}
/** Provider-reported token buckets; reasoning/cacheWrite1h are subsets, not additions. */
export interface IndexUsageAmounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  reasoning?: number;
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } | null;
}
export type IndexUsageMeasurement =
  | { measurementState: "reported"; usage: IndexUsageAmounts; reason: null }
  | { measurementState: "pending"; usage: null; reason: null }
  | { measurementState: "unknown"; usage: null; reason: string };
/** Session receipt copied from the ledger, never a model-authored billing assertion. */
export type IndexUsageReceipt = IndexUsageMeasurement & {
  usageEventId: Id;
  modelRequestId: Id;
  revision: number;
  ownerWorkspaceId: Id;
  ownerSessionId: Id;
  ownerRunId: Id;
  provider: string;
  model: string;
};
export interface IndexUsageEnvelope {
  version: 1;
  usageEventIds: Id[]; // exactly the unique event IDs in events
  events: IndexUsageReceipt[];
}
/** Host-owned tool details; context metadata also governs request-local filtering of old results. */
export interface IndexToolDetails {
  result: LocateResult | OverviewPackage;
  axiomIndexContext: { indexKey: Id; workspaceId: Id; policyHash: string };
  axiomIndexProgress?: IndexProgress; // final factual snapshot, not a second usage receipt
  // The same usage envelope is used by axiom-index-usage custom entries.
  axiomIndexUsage?: IndexUsageEnvelope;
}
/** Target AgentInfo.usage.indexAccounting; numeric totals remain known subtotals when incomplete. */
export interface IndexUsageAccounting {
  pendingRequests: number;
  unknownRequests: number;
  unknownCostRequests: number; // reported tokens whose price is unknown
}
export interface ModelBudget {
  workMs: number;
  maxModelRequests: number; // physical provider requests, including session-level retries
  maxInputTokens: number;
  maxOutputTokens: number;
}
export interface IndexSettings {
  mode: Mode;
  automaticMaintenance: boolean;
  backgroundSelection: ModelSelection | null; // never the last active chat's selection
  locateBudget: ModelBudget;
  jobBudget: ModelBudget;
}
/** Immutable execution ownership, issued by the host, never by tool arguments.
 * A foreground call must have a session/run/native tool-call identity; a job
 * must have its current lease. SubmissionOwner deliberately omits transient IDs.
 */
export type LocatorExecutionOwner =
  | (Extract<SubmissionOwner, { purpose: "locate" }> & { toolCallId: Id; leaseId: null })
  | (Extract<SubmissionOwner, { purpose: JobPurpose }> & { toolCallId: null; leaseId: Id });
export interface LocatorAttemptIdentity {
  requestId: Id;
  attemptId: Id; // a new attempt gets a new ledger, not a new total budget
  admissionId: Id;
  owner: LocatorExecutionOwner;
  indexWorkerIncarnation: Id;
  locatorWorkerIncarnation: Id;
}
/** Serializable, host-only launch data. Only these whitelisted fields go on IPC.
 * purpose/indexKey/workspaceId come from identity.owner, with no duplicate overrides.
 */
export interface LocatorLaunch {
  identity: LocatorAttemptIdentity;
  cwd: string;
  modelsFile: string; // existing host-created frozen snapshot
  selection: ModelSelection;
  systemPrompt: string;
  task: string;
  allowedToolNames: readonly ["index_query", "code_evidence", "index_submit"];
  budget: ModelBudget;
}
/** Local runner argument; signal is translated to an identity-bound cancel message. */
export interface LocatorRunSpec {
  launch: LocatorLaunch;
  signal: AbortSignal;
}
/** The three model-callable payloads; ownership is supplied only by the host envelope. */
export type LocatorToolCall =
  | { tool: "index_query"; input: IndexQueryInput }
  | { tool: "code_evidence"; input: CodeEvidenceInput }
  | { tool: "index_submit"; input: IndexProposal };
/** Request-side tool/cancel messages, not the entire production IPC protocol.
 * Replies, activity, usage reservation/settlement and final admission must use the
 * same identity binding and strict operation-specific schemas frozen in stage 0.
 */
export type LocatorControlMessage = {
  version: 1;
  identity: LocatorAttemptIdentity;
} & (
  | { type: "tool_call"; callId: Id; call: LocatorToolCall } // internal RPC ID, not owner.toolCallId
  | { type: "cancel"; reason: "caller_cancelled" | "revoked" | "deadline" | "shutdown" }
);
/** Internal runner observations. Only the outer executor can report a DB commit.
 * The callback is bound to LocatorRunSpec; no prompt, thinking or result body here.
 */
export interface LocatorActivity {
  phase: "model_request" | "index_query" | "code_evidence" | "index_submit";
  state: "started" | "settled";
}
/** References only. The worker's frozen index_submit draft is the sole proposal
 * source; final model prose or a second runner-supplied body cannot replace it.
 */
export interface LocatorRunResult {
  acceptedProposalDigest: string | null; // copied from SubmitReceipt, not model-authored
  usageEventIds: Id[]; // ledger references, never a substitute for pre-send reservation
  stop: "completed" | "cancelled" | "budget" | "error";
}
/** Local, attempt-bound proxy to the worker. No generic command/SQL/commit method.
 * Host construction binds the same identity as the runner; parameters cannot
 * select another owner or attempt. index_submit accepts a draft, never commits it.
 */
export interface LocatorToolPort {
  index_query(input: IndexQueryInput, signal: AbortSignal): Promise<IndexQueryResult>;
  code_evidence(input: CodeEvidenceInput, signal: AbortSignal): Promise<CodeEvidenceResult>;
  index_submit(input: IndexProposal, signal: AbortSignal): Promise<SubmitReceipt>;
}
/** The implementation reserves/persists EACH physical request through the private
 * host accounting bridge before provider I/O, even before the first tool call.
 * The three model tools and final usageEventIds cannot provide that admission.
 */
export interface LocatorRunnerPort {
  runLocator(spec: LocatorRunSpec, tools: LocatorToolPort,
    onActivity?: (activity: LocatorActivity) => void | Promise<void>): Promise<LocatorRunResult>;
}
/** Caller-authorized tool facade over the indexKey pool. Each binding freezes
 * the host-derived workspace/session/run/call identity; arguments cannot override it.
 * Authorization is rechecked per call and after async admission, not frozen forever.
 * The injected object exposes only these methods, not a cast of the full manager.
 */
export interface IndexService {
  readonly indexKey: Id;
  locate(input: LocateInput, signal: AbortSignal, onProgress?: IndexProgressObserver): Promise<LocateResult>;
  overview(input: OverviewRequest, signal: AbortSignal): Promise<OverviewPackage>;
}
/** Browser reads have their own host-issued view binding; they never acquire a
 * locator ledger, run/tool identity, model budget or semantic-write capability.
 */
export interface IndexBrowseSnapshot {
  viewId: Id;
  indexKey: Id;
  workspaceId: Id;
  snapshotId: Id;
  observedEpoch: number;
  semanticEpoch: number;
  policyHash: string;
  analysisContextHash: string;
}
export type IndexBrowseObject = ObjectRevision & {
  name: string;
  summary: string;
  freshness: Freshness;
} & (
  | { kind: Exclude<ObjectKind, "edge" | "knowledge"> }
  | { kind: "knowledge"; knowledgeType: "contract" | "constraint" | "decision"; assertion: "observed" | "specified" }
);
export interface IndexBrowseRelation extends ObjectRevision {
  fromId: Id;
  target: { objectId: Id } | { sourceRefId: Id };
  relation: Relation;
  slot: string;
  role?: LocationRole;
  reason: string;
  evidenceIds: Id[];
  freshness: Freshness;
}
/** A row is a reference, not a copied entity. UI keys include the occurrence path
 * and edge ID; a global objectId-only visited set would hide legitimate sharing.
 */
export type IndexBrowseRow =
  | { kind: "object"; object: IndexBrowseObject; via: IndexBrowseRelation | null; hasChildren: boolean | null }
  | { kind: "source"; sourceRef: SourceRef; via: IndexBrowseRelation };
export type IndexBrowseTarget =
  | { kind: "roots"; category: Exclude<ObjectKind, "edge"> }
  | { kind: "children"; parentId: Id }
  | { kind: "search"; query: string; kinds?: Exclude<ObjectKind, "edge">[] };
export type IndexBrowsePageState =
  | { complete: true; nextCursor: null }
  | { complete: false; nextCursor: string };
export type IndexBrowseListPage = {
  snapshot: IndexBrowseSnapshot;
  rows: IndexBrowseRow[];
  coverage: Coverage;
} & IndexBrowsePageState;
/** Closed, bounded detail fragments, not raw body:any/SQL. Flow endpoints travel
 * with their authorized occurrence and implementation; truncation cannot invent
 * connections. Full evidence is read via sourceRef IDs under the same policy.
 */
export interface IndexBrowseFlowStep {
  edge: IndexBrowseRelation & { relation: "uses"; target: { objectId: Id } };
  implementation: IndexBrowseObject & { kind: "implementation" };
}
export type IndexBrowseDetailItem = { key: Id } & (
  // key is stable within object+snapshot, including cursor retries.
  | { kind: "fact"; fact: EvidenceClaim }
  | { kind: "symbol"; declarationKind: string; qualifiedName: string; sourceRef: SourceRef }
  | { kind: "boundary"; includes: string; excludes: string[] }
  | { kind: "unknown"; text: string }
  | { kind: "relation"; relation: IndexBrowseRelation; target: IndexBrowseObject | SourceRef }
  | { kind: "flow"; flow: FlowAssertion; before: IndexBrowseFlowStep; after: IndexBrowseFlowStep }
  | { kind: "evidence"; evidence: Extract<EvidenceRecord, { kind: "source_range" }>; sourceRef: SourceRef }
  | { kind: "evidence"; evidence: Extract<EvidenceRecord, { kind: "scope_observation" }>; sourceRef: null }
);
export type IndexBrowseObjectPage = {
  snapshot: IndexBrowseSnapshot;
  object: IndexBrowseObject;
  items: IndexBrowseDetailItem[];
  coverage: Coverage;
} & IndexBrowsePageState;
export type IndexBrowseSourcePage = {
  snapshot: IndexBrowseSnapshot;
  requestedSourceRefId: Id; // original reference being paged; stays bound to the cursor
  sourceRef: SourceRef; // THIS page's actual UTF-16 range and range-specific ID, not a rewritten durable ref
  text: string;
} & IndexBrowsePageState;
export type IndexBrowseResult<T> =
  | { status: "ok"; value: T }
  | { status: "error"; error: { code: ErrorCode; retryable: boolean; message: string } };
/** Only invalidation facts, no hidden object IDs/names or chat content. Host
 * subscriptions validate the connection/view and monotonic sequence; revoked
 * views clear immediately. Ordinary updates can preserve navigation and focus.
 */
export interface IndexBrowseNotice {
  version: 1;
  viewId: Id;
  sequence: number;
  reason: "changed" | "policy_changed" | "unavailable";
}
/** Immutable navigation hints for a user annotation, not an evidence ledger,
 * capability, proposal or authority to edit code. The browser remains read-only.
 * Minimal revisions avoid embedding complete object bodies in every annotation.
 */
export interface IndexAnnotationStep {
  edge: ObjectRevision; // the selected uses occurrence, not merely its implementation
  slot: string;
  implementation: ObjectRevision;
}
export type IndexAnnotationContext =
  | { kind: "feature"; feature: ObjectRevision }
  | { kind: "step"; feature: ObjectRevision; step: IndexAnnotationStep }
  | { kind: "flow"; feature: ObjectRevision; key: Id; flow: FlowAssertion;
      before: IndexAnnotationStep; after: IndexAnnotationStep };
export type IndexAnnotationTarget = IndexAnnotationContext | {
  kind: "source";
  context: IndexAnnotationContext;
  requestedSourceRefId: Id;
  pageSourceRef: SourceRef; // actual delivered page, not the whole original reference
  selection: SourceRef["range"]; // contained in pageSourceRef.range; exact quote, no offset rebasing
};
export interface IndexAnnotationDraft {
  id: Id;
  owner: { workspaceId: Id; sessionId: Id | null }; // null supports workspace-only drafts/copy, not sending
  snapshot: IndexBrowseSnapshot; // capture identity only; expired viewId is never a new authorization
  target: IndexAnnotationTarget;
  fragment: { key: Id; start: number; end: number }; // UTF-16 half-open offsets within one displayed fragment
  quote: string; // immutable exact selection, <=6000 JS string units; source text is untrusted reference data
  text: string; // user opinion, <=2000; serialized batch INCLUDING location metadata <=12000
  intent: "change_code" | "correct_index" | "ask";
  capturedFreshness: Freshness; // not a claim of current validity when subsequently sent
}
/** Local host port for the browser adapter, separate from IndexService/model
 * tools and IndexAdminService. All methods recheck current authorization.
 * Production IPC carries DTOs only; signal stays local to each adapter.
 */
export interface IndexBrowseService {
  readonly indexKey: Id;
  readonly viewId: Id;
  list(input: { target: IndexBrowseTarget; snapshotId?: Id; cursor?: string }, signal: AbortSignal): Promise<IndexBrowseResult<IndexBrowseListPage>>;
  getObject(input: { objectId: Id; snapshotId?: Id; cursor?: string }, signal: AbortSignal): Promise<IndexBrowseResult<IndexBrowseObjectPage>>;
  readSource(input: { sourceRefId: Id; snapshotId: Id; cursor?: string }, signal: AbortSignal): Promise<IndexBrowseResult<IndexBrowseSourcePage>>;
}
export type IndexChangeHint = { paths: string[] } & (
  | { source: "tool"; workspaceId: Id; sessionId: Id; runId: Id; toolCallId: Id }
  | { source: "watcher" | "reconcile" }
);
/** Trusted host notification sink bound to one indexKey, not a request/reply router.
 * Tool/run scopes come from the host and are checked against that indexKey;
 * watcher/reconcile events never invent a run owner. File hints are not proof of
 * success, change or access. Multi-subscriber events are isolated; request/reply
 * ownership stays with one identity-bound RPC router.
 */
export interface IndexChangeSink {
  readonly indexKey: Id;
  /** No model invocation. Persist/coalesce invalidations before scheduling. */
  recordChanges(change: IndexChangeHint): Promise<void>;
  /** Persist intent only; validate the full run scope and never await model maintenance. */
  settleRun(scope: { workspaceId: Id; sessionId: Id; runId: Id },
    outcome: "completed" | "failed" | "cancelled" | "interrupted"): Promise<void>;
}
/** Authorized bounded snapshot, not a raw store dump. Nullable facts stay unknown;
 * counters include only the authorized view, not hidden object/job identities.
 */
export interface IndexStatus {
  indexKey: Id;
  mode: Mode;
  state: "closed" | "opening" | "reconciling" | "ready" | "degraded" | "closing";
  coverage: Coverage | null;
  jobs: { pending: number; running: number; blocked: number } | null;
  lastCommittedAt: number | null; // epoch milliseconds
  usage: { knownSubtotal: IndexUsageAmounts | null; accounting: IndexUsageAccounting } | null;
  problems: { code: ErrorCode; message: string }[];
}
export interface IndexDoctorReport {
  indexKey: Id;
  checks: {
    code: string;
    outcome: "ok" | "warning" | "error" | "unknown";
    message: string; // bounded, authorized explanation, never a raw SQL/stack dump
    objectIds: Id[];
  }[];
}
/** Host management entry with a separate authorization gate; never a model tool. */
export interface IndexAdminService {
  readonly indexKey: Id;
  sync(signal: AbortSignal): Promise<void>; // mechanical reconciliation, no model invocation
  status(signal: AbortSignal): Promise<IndexStatus>;
  doctor(signal: AbortSignal): Promise<IndexDoctorReport>;
}
/** Lifecycle of one IndexManager's ENTIRE indexKey pool; held only by the host
 * composition root. Per-index eviction stays inside the manager. Releasing a
 * caller binding removes its references/listeners and cannot invoke this close.
 */
export interface IndexResourceOwner {
  beginShutdown(): void; // synchronously reject new admissions; cancellation is not yet complete
  close(): Promise<void>; // idempotent; begin shutdown if needed, drain, persist and release
}

/** Service-issued cursors resume the same operation/range within one attempt and
 * basis snapshot; they can advance within a line. Keep all original arguments. */
export type EvidenceOperation =
  | { kind: "search"; text: string; scopeId: Id; caseSensitive: boolean; cursor?: string }
  | { kind: "read"; path: string; startLine: number; endLine: number; cursor?: string } // zero-based [startLine,endLine)
  | { kind: "fetch_ref"; sourceRefId: Id; cursor?: string }
  | { kind: "definition" | "references"; symbolId: Id; cursor?: string }
  | { kind: "changes"; scopeId: Id; cursor?: string };
export interface IndexQueryInput {
  query?: string;
  ids?: Id[];
  scopeIds?: Id[];
  direction?: "outgoing" | "incoming";
  cursor?: string;
}
export interface IndexQueryResult {
  readToken: ReadToken;
  objects: (ObjectRevision & {
    kind: ObjectKind;
    name: string;
    lifecycle: "active" | "retired";
    freshness: Freshness;
    body: unknown; // validated stored union, not an unvalidated model response
  })[];
  evidence: EvidenceRecord[]; // resolves body evidence IDs; not proof of a fresh read
  sourceRefs: SourceRef[]; // can be opened with code_evidence.fetch_ref
  scopes: { id: Id; definition: ScopeDefinition; definitionHash: string }[];
  coverage: Coverage;
  nextCursor?: string;
}
/** Completion of the requested operation range, not necessarily the entire file.
 * An incomplete page either advances via cursor or stops with an explicit error. */
export type EvidencePageState =
  | { truncated: false; nextCursor?: never; error?: never }
  | { truncated: true; nextCursor: string; error?: never }
  | { truncated: true; nextCursor?: never; error: { code: ErrorCode; message: string } };
export interface CodeEvidenceInput { operations: EvidenceOperation[] }
export interface CodeEvidenceResult {
  readToken: ReadToken;
  operations: ({
    operationIndex: number; // exactly one result per input operation
    evidence: {
      record: EvidenceRecord;
      source?: { ref: SourceRef; text: string }; // THIS page's exact range; never the full range on a partial page
    }[];
    candidates: { symbolId?: Id; path: string; label: string }[]; // navigation, not read proof
  } & EvidencePageState)[];
}
/** Issued after freezing the attempt-local draft. Digest is SHA-256/JCS of the
 * complete accepted IndexProposal before temporary-ID mapping, not a semantic hash.
 * An authorized same-attempt retry of identical content returns the same receipt.
 */
export interface SubmitReceipt { accepted: true; proposalDigest: string; committed: false }
/** Durable host ownership for submissions.owner_json; survives request-ledger expiry. */
export type SubmissionOwner = { indexKey: Id; workspaceId: Id } & (
  | { purpose: "locate"; sessionId: Id; runId: Id; jobId: null }
  | { purpose: JobPurpose; sessionId: null; runId: null; jobId: Id }
);

type ExportedNode<T extends NodeProposal = NodeProposal> = T extends NodeProposal
  ? { kind: T["kind"]; body: Omit<T, "id" | "kind" | "expectedContentRev" | "expectedRecordRev"> }
  : never;
/** Closed semantic body union; edge endpoints live exclusively in matching links. */
export type ExportedObject = ObjectRevision & { lifecycle: "active" | "retired" } & (
  | ExportedNode
  | { kind: "edge"; body: Pick<EdgeProposal, "role" | "reason" | "evidenceIds"> }
);

/** Semantic interchange only. Filter the full reference closure under current
 * authorization before export; import remaps IDs, stages candidates and revalidates. */
export interface SemanticExport {
  format: "axiom-semantic/1";
  schemaVersion: number;
  createdAt: string;
  origin: { workspaceLabel: string; revisionHint?: string };
  policyHash: string;
  scopes: { id: Id; definition: ScopeDefinition; definitionHash: string }[];
  objects: ExportedObject[];
  // Exactly one link per edge object; endpoints must resolve inside this package.
  links: { id: Id; fromId: Id; target: { objectId: Id } | { sourceRefId: Id }; relation: Relation; slot: string }[];
  // Only relocation descriptors for referenced symbols, not a portable parser cache.
  symbols: { id: Id; path: string; naturalKey: string; declarationKind: string; qualifiedName: string; sourceRefId: Id }[];
  sourceRefs: { id: Id; path: string; contentHash: string; range: SourceRef["range"] }[];
  evidence: EvidenceRecord[]; // every assertion/edge/flow evidence ID resolves here
  omitted: { code: "policy_filtered" | "unresolved_reference"; count: number }[]; // no hidden IDs/names/paths
  checksum: string; // SHA-256 of RFC 8785/JCS JSON excluding checksum
}
