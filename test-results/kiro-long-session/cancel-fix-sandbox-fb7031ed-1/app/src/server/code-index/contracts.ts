import type { Selection } from "../../shared/agent.js";
import type {
  Id, ObjectKind, SemanticKind, SourceRef, ScopeDefinition, EvidenceRecord, Coverage, EvidenceClaim,
  FlowAssertion, Relation, LocationRole, ObjectRevision, ReadToken, Freshness, IndexSettings,
  ModelBudget, IndexUsageMeasurement, IndexErrorCode,
} from "../../shared/code-index.js";
export type { Id, ObjectKind, SemanticKind, SourceRef, ScopeDefinition, EvidenceRecord, Coverage,
  EvidenceClaim, FlowAssertion, Relation, LocationRole, ObjectRevision, ReadToken, Freshness,
  IndexSettings, ModelBudget, IndexUsageMeasurement, IndexErrorCode };

export type RunPurpose = "locate" | "bootstrap" | "maintain" | "import_review";
export type JobPurpose = Exclude<RunPurpose, "locate">;
interface NodeBase {
  id: Id; expectedContentRev: number | null; expectedRecordRev: number | null;
  name: string; summary: string; aliases: string[]; facts: EvidenceClaim[];
  boundary: { includes: string; excludes: string[] }; unknowns: string[]; coverage: Coverage;
}
export type NodeProposal =
  | (NodeBase & { kind: "module"; scopeIds: Id[] })
  | (NodeBase & { kind: "implementation" })
  | (NodeBase & { kind: "feature"; flows: FlowAssertion[] })
  | (NodeBase & { kind: "knowledge"; knowledgeType: "contract" | "constraint" | "decision";
      assertion: "observed" | "specified"; rationale: string | null; authoritySourceIds: Id[] });
export interface EdgeProposal {
  id: Id; expectedContentRev: number | null; expectedRecordRev: number | null;
  fromId: Id; target: { objectId: Id } | { sourceRefId: Id }; relation: Relation; slot: string;
  role?: LocationRole; reason: string; evidenceIds: Id[];
}
export interface ResultSelection {
  objectIds: Id[]; locations: { sourceRefId: Id; symbolId?: Id; role: LocationRole; reason: string }[];
  featurePaths: Id[][]; knowledgeIds: Id[];
}
export interface IndexProposal {
  version: "index-proposal/1"; requestId: Id; nodes: NodeProposal[]; edges: EdgeProposal[];
  reviews: { id: Id; expectedContentRev: number; expectedRecordRev: number; evidenceIds: Id[]; scopeIds: Id[] }[];
  retire: LifecycleChange[]; reactivate: LifecycleChange[];
  result: { status: "ok" | "partial" | "not_found"; selection: ResultSelection; searchedScopeIds: Id[]; coverage: Coverage };
}
export interface LifecycleChange {
  id: Id; expectedContentRev: number; expectedRecordRev: number; reason: string; evidenceIds: Id[];
}
export interface BasisItem { kind: "file" | "scope" | "object" | "context"; key: string; version: string }
export interface StoredObject extends ObjectRevision {
  kind: ObjectKind; name: string; naturalKey: string | null; filePath: string | null;
  body: NodeProposal | EdgeProposal | SymbolBody;
  contentHash: string; review: { basis: BasisItem[]; evidenceIds: Id[]; scopeIds: Id[]; unresolved?: boolean };
  lifecycle: "active" | "retired";
}
export interface SymbolBody {
  kind: "symbol"; qualifiedName: string; declarationKind: string; sourceRefId: Id; naturalKey: string;
  ambiguity: boolean;
}
export interface StoredLink {
  id: Id; fromId: Id; target: { objectId: Id } | { sourceRefId: Id }; relation: Relation; slot: string;
}
export interface IndexedFile {
  path: string; contentHash: string | null; language: string; status: "present" | "deleted" | "parse_error" | "unresolved";
  sizeBytes: number; observedEpoch: number;
}
export interface FileSnapshot { path: string; contentHash: string; text: string; sizeBytes: number; category: "code" | "document" | "config" | "text" }
export interface ScopeSnapshot {
  id: Id; definition: ScopeDefinition; definitionHash: string; contentDigest: string; revision: number;
}
export interface SourceSnapshot {
  files: Map<string, FileSnapshot>; scopes: ScopeSnapshot[]; policyHash: string; analysisContextHash: string;
  complete: boolean; gaps: Coverage["gaps"];
}
export interface RequestLedger {
  ledgerId: Id; requestId: Id; attemptId: Id; owner: SubmissionOwner; basis: BasisItem[];
  evidence: EvidenceRecord[]; sourceRefs: SourceRef[]; readObjectIds: Id[]; expiresAt: number;
  evidenceSources: { evidenceId: Id; paths: string[] }[];
  readRanges: { path: string; contentHash: string; intervals: [number, number][] }[];
}
export type SubmissionOwner = { indexKey: Id; workspaceId: Id } & (
  | { purpose: "locate"; sessionId: Id; runId: Id; jobId: null }
  | { purpose: JobPurpose; sessionId: null; runId: null; jobId: Id }
);
export type LocatorExecutionOwner =
  | (Extract<SubmissionOwner, { purpose: "locate" }> & { toolCallId: Id; leaseId: null })
  | (Extract<SubmissionOwner, { purpose: JobPurpose }> & { toolCallId: null; leaseId: Id });
export interface LocatorAttemptIdentity {
  requestId: Id; attemptId: Id; admissionId: Id; owner: LocatorExecutionOwner;
  indexWorkerIncarnation: Id; locatorWorkerIncarnation: Id;
}
export interface LocatorLaunch {
  identity: LocatorAttemptIdentity; cwd: string; modelsFile: string; selection: Selection;
  systemPrompt: string; task: string; allowedToolNames: readonly ["index_query", "code_evidence", "index_submit"]; budget: ModelBudget;
}
export interface LocatorRunResult { acceptedProposalDigest: string | null; usageEventIds: Id[]; stop: "completed" | "cancelled" | "budget" | "error" }
export type EvidenceOperation =
  | { kind: "search"; text: string; scopeId: Id; caseSensitive: boolean; cursor?: string }
  | { kind: "read"; path: string; startLine: number; endLine: number; cursor?: string }
  | { kind: "fetch_ref"; sourceRefId: Id; cursor?: string }
  | { kind: "definition"; symbolId: Id; cursor?: string }
  | { kind: "references"; symbolId: Id; cursor?: string }
  | { kind: "changes"; scopeId: Id; cursor?: string };
export interface CodeEvidenceInput { operations: EvidenceOperation[] }
export type EvidencePageState =
  | { truncated: false; nextCursor?: never; error?: never }
  | { truncated: true; nextCursor: string; error?: never }
  | { truncated: true; nextCursor?: never; error: { code: IndexErrorCode; message: string } };
export interface CodeEvidenceResult {
  readToken: ReadToken;
  operations: ({ operationIndex: number; evidence: { record: EvidenceRecord; source?: { ref: SourceRef; text: string } }[];
    candidates: { symbolId?: Id; sourceRefId?: Id; path: string; label: string }[] } & EvidencePageState)[];
}
export interface IndexQueryInput { query?: string; ids?: Id[]; scopeIds?: Id[]; direction?: "outgoing" | "incoming"; cursor?: string }
export interface IndexQueryResult {
  readToken: ReadToken;
  objects: (ObjectRevision & { kind: ObjectKind; name: string; lifecycle: "active" | "retired"; freshness: Freshness;
    body: StoredObject["body"] })[];
  evidence: EvidenceRecord[]; sourceRefs: SourceRef[];
  scopes: { id: Id; definition: ScopeDefinition; definitionHash: string }[]; coverage: Coverage; nextCursor?: string;
}
export interface SubmitReceipt { accepted: true; proposalDigest: string; committed: false }
export interface Submission {
  requestId: Id; proposalDigest: string; owner: SubmissionOwner;
  outcome: {
    result: IndexProposal["result"]; objectRevisions: ObjectRevision[]; idMap: Record<string, string>; basis: BasisItem[];
    lifecycleChanges: { id: Id; action: "retire" | "reactivate"; reason: string; evidenceIds: Id[]; before: ObjectRevision; after: ObjectRevision }[];
  }; committedAt: number;
}
export interface MaintenanceJob {
  id: Id; groupId: Id | null; indexKey: Id; ownerWorkspaceId: Id | null; originRunIds: Id[];
  purpose: JobPurpose; scopeIds: Id[]; eventHighWatermark: number; inputDigest: string;
  state: "pending" | "running" | "done" | "blocked" | "cancelled" | "interrupted";
  reason: string | null; attempt: number; leaseId: Id | null; leaseUntil: number | null;
  nextAttemptAt: number | null; config: { selection: Selection | null }; budget: ModelBudget;
  consumed: { modelRequests: number; input: number; output: number; workMs: number };
  checkpoint: { completedScopeIds: Id[] }; createdAt: number; updatedAt: number;
}
export type UsageEvent = IndexUsageMeasurement & {
  id: Id; modelRequestId: Id; requestId: Id; attemptId: Id; owner: SubmissionOwner;
  provider: string; model: string; revision: number; accountingState: "workspace" | "session_pending" | "session_recorded";
  reservedInput: number; reservedOutput: number; createdAt: number;
};
export interface ContextEntryStamp { entryId: Id; sourceHash: string; projectedHash: string }
export type ContextFocusSignal = ContextEntryStamp & (
  | { kind: "user_input" }
  | { kind: "index_tool" | "file_tool"; toolCallId: Id; call: ContextEntryStamp }
);
export type ContextSelectionReason = "workspace_overview" | "workspace_constraint" | "explicit_object" |
  "path_or_symbol" | "query_terms" | "graph_neighbor" | "applicable_knowledge" | "conflict";
export interface ContextFocusSnapshot {
  version: 1; selectorVersion: string; branchLeafId: Id | null; latestConsumedInputEntryId: Id | null; userAnchorEntryId: Id | null;
  signals: ContextFocusSignal[];
  selections: { objectId: Id; reasons: ContextSelectionReason[]; signalEntryIds: Id[] }[];
}
export interface ContextDelivery {
  deliveryId: Id; modelRequestId: Id | null; indexKey: Id; workspaceId: Id; policyHash: string;
  sessionId: Id; runId: Id; contextGeneration: string; focus: ContextFocusSnapshot;
  packageId: Id; bodyHash: string; objectRevisions: ObjectRevision[]; scopeIds: Id[];
  state: "prepared" | "included" | "obsolete";
}
type ExportedNode<T extends NodeProposal = NodeProposal> = T extends NodeProposal
  ? { kind: T["kind"]; body: Omit<T, "id" | "kind" | "expectedContentRev" | "expectedRecordRev"> } : never;
export type ExportedObject = ObjectRevision & { lifecycle: "active" | "retired" } & (
  | ExportedNode | { kind: "edge"; body: Pick<EdgeProposal, "role" | "reason" | "evidenceIds"> }
);
export interface SemanticExport {
  format: "axiom-semantic/1"; schemaVersion: number; createdAt: string;
  origin: { workspaceLabel: string; revisionHint?: string }; policyHash: string;
  scopes: { id: Id; definition: ScopeDefinition; definitionHash: string }[]; objects: ExportedObject[]; links: StoredLink[];
  symbols: { id: Id; path: string; naturalKey: string; declarationKind: string; qualifiedName: string; sourceRefId: Id }[];
  sourceRefs: Omit<SourceRef, "workspaceId">[]; evidence: EvidenceRecord[];
  omitted: { code: "policy_filtered" | "unresolved_reference"; count: number }[]; checksum: string;
}
