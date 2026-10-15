import type { Selection } from "./agent.js";

/** Public, serializable index data. A reference is never an authorization grant. */
export type Id = string;
export type ObjectKind = "symbol" | "module" | "implementation" | "feature" | "knowledge" | "edge";
export type SemanticKind = Exclude<ObjectKind, "symbol" | "edge">;
export type Freshness = "current" | "stale" | "unresolved";
export type IndexMode = "off" | "observe" | "assist" | "native";
export type Relation = "contains" | "uses" | "code" | "test" | "relates" | "applies_to" | "contradicts";
export type LocationRole = "primary" | "entry" | "guard" | "contract" | "test";
export type IndexErrorCode = "DISABLED" | "NOT_READY" | "INVALID_INPUT" | "ACCESS_DENIED" |
  "FILE_CHANGED" | "WORKSPACE_CHANGED" | "RECORD_CHANGED" | "INVALID_PROPOSAL" |
  "AMBIGUOUS_REUSE" | "BUDGET_EXCEEDED" | "CANCELLED" | "MODEL_UNAVAILABLE" |
  "STORE_BUSY" | "STORE_FAILED" | "UNSUPPORTED_SCHEMA" | "SNAPSHOT_EXPIRED";
export interface SourceRef {
  id: Id; workspaceId: Id; path: string; contentHash: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number }; encoding: "utf-16" };
}
export interface ScopeDefinition { include: string[]; exclude: string[] }
export type EvidenceRecord =
  | { id: Id; kind: "source_range"; sourceRefId: Id }
  | { id: Id; kind: "scope_observation"; scopeId: Id; definition: ScopeDefinition; definitionHash: string;
      contentDigest: string; policyHash: string; analysisContextHash: string;
      operation: "search" | "changes" | "manifest"; query: { text: string; caseSensitive: boolean } | null;
      complete: boolean; observation: string };
export interface Coverage { mode: "partial" | "reviewed_scope"; scopeIds: Id[]; gaps: { code: string; description: string; scopeId?: Id }[] }
export interface ReadToken {
  workspaceId: Id; observedEpoch: number; semanticEpoch: number; policyHash: string;
  analysisContextHash: string; ledgerId: Id; consistency: "verified_basis" | "unresolved";
}
export interface EvidenceClaim {
  kind: "responsibility" | "trigger" | "condition" | "action" | "result" | "contract" | "constraint" | "decision";
  assertion: "observed" | "specified"; text: string; evidenceIds: Id[];
}
export interface FlowAssertion { beforeEdgeId: Id; afterEdgeId: Id; condition: string; evidenceIds: Id[] }
export interface ObjectRevision { id: Id; contentRev: number; recordRev: number }
export interface LocateInput { query: string; hints?: { paths?: string[]; symbols?: string[] }; cursor?: string }
export interface LocateResult {
  status: "ok" | "partial" | "not_found" | "error"; query: string; maintained: boolean; freshness: Freshness;
  readToken: ReadToken | null;
  locations: { symbolId?: Id; sourceRef: SourceRef; role: LocationRole; reason: string; freshness: Freshness }[];
  selectedObjectIds: Id[]; featurePaths: { id: Id; name: string }[][];
  knowledge: { id: Id; name: string; assertion: "observed" | "specified"; summary: string; freshness: Freshness; sourceRefs: SourceRef[] }[];
  coverage: Coverage; searchedScopeIds: Id[]; nextCursor?: string;
  error?: { code: IndexErrorCode; retryable: boolean; message: string };
}
export interface IndexProgress {
  version: 1; requestId: Id; attemptId: Id | null; sequence: number;
  phase: "queued" | "querying" | "reading" | "analyzing" | "validating" | "committing" |
    "completed" | "failed" | "cancelled" | "interrupted";
  elapsedMs: number; modelRequestsStarted: number; evidencePages: number;
}
export interface OverviewRequest { scopeIds?: Id[]; cursor?: string }
export interface OverviewPackage {
  packageId: Id; workspaceId: Id; snapshotId: Id; semanticEpoch: number; policyHash: string;
  rendererVersion: string; bodyHash: string; text: string; objectIds: Id[]; objectRevisions: ObjectRevision[];
  coverage: Coverage; freshness: Freshness; nextCursor?: string;
}
export interface IndexUsageAmounts {
  input: number; output: number; cacheRead: number; cacheWrite: number; cacheWrite1h?: number; reasoning?: number;
  totalTokens: number; cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } | null;
}
export type IndexUsageMeasurement =
  | { measurementState: "reported"; usage: IndexUsageAmounts; reason: null }
  | { measurementState: "pending"; usage: null; reason: null }
  | { measurementState: "unknown"; usage: null; reason: string };
export type IndexUsageReceipt = IndexUsageMeasurement & {
  usageEventId: Id; modelRequestId: Id; revision: number; ownerWorkspaceId: Id; ownerSessionId: Id; ownerRunId: Id;
  provider: string; model: string;
};
export interface IndexUsageEnvelope { version: 1; usageEventIds: Id[]; events: IndexUsageReceipt[] }
export interface IndexUsageAccounting { pendingRequests: number; unknownRequests: number; unknownCostRequests: number }
export interface IndexToolDetails {
  result: LocateResult | OverviewPackage;
  axiomIndexContext: { indexKey: Id; workspaceId: Id; policyHash: string };
  axiomIndexProgress?: IndexProgress; axiomIndexUsage?: IndexUsageEnvelope;
}
export interface ModelBudget { workMs: number; maxModelRequests: number; maxInputTokens: number; maxOutputTokens: number }
export interface IndexSettings {
  mode: IndexMode; automaticMaintenance: boolean; backgroundSelection: Selection | null;
  locateBudget: ModelBudget; jobBudget: ModelBudget;
}
export const defaultIndexSettings: IndexSettings = {
  mode: "off", automaticMaintenance: true, backgroundSelection: null,
  locateBudget: { workMs: 60_000, maxModelRequests: 4, maxInputTokens: 48_000, maxOutputTokens: 8_000 },
  jobBudget: { workMs: 120_000, maxModelRequests: 3, maxInputTokens: 48_000, maxOutputTokens: 8_000 },
};
export interface IndexStatus {
  indexKey: Id; mode: IndexMode; state: "closed" | "opening" | "reconciling" | "ready" | "degraded" | "closing";
  coverage: Coverage | null; jobs: { pending: number; running: number; blocked: number } | null;
  lastCommittedAt: number | null;
  usage: { knownSubtotal: IndexUsageAmounts | null; accounting: IndexUsageAccounting } | null;
  problems: { code: IndexErrorCode; message: string }[];
}
export interface IndexDoctorReport {
  indexKey: Id; checks: { code: string; outcome: "ok" | "warning" | "error" | "unknown"; message: string; objectIds: Id[] }[];
}
export interface IndexBrowseSnapshot {
  viewId: Id; indexKey: Id; workspaceId: Id; snapshotId: Id; observedEpoch: number; semanticEpoch: number;
  policyHash: string; analysisContextHash: string;
}
export type IndexBrowseObject = ObjectRevision & { name: string; summary: string; freshness: Freshness } & (
  | { kind: Exclude<ObjectKind, "edge" | "knowledge"> }
  | { kind: "knowledge"; knowledgeType: "contract" | "constraint" | "decision"; assertion: "observed" | "specified" }
);
export interface IndexBrowseRelation extends ObjectRevision {
  fromId: Id; target: { objectId: Id } | { sourceRefId: Id }; relation: Relation; slot: string;
  role?: LocationRole; reason: string; evidenceIds: Id[]; freshness: Freshness;
}
export type IndexBrowseRow =
  | { kind: "object"; object: IndexBrowseObject; via: IndexBrowseRelation | null; hasChildren: boolean | null }
  | { kind: "source"; sourceRef: SourceRef; via: IndexBrowseRelation };
export type IndexBrowseTarget =
  | { kind: "roots"; category: Exclude<ObjectKind, "edge"> }
  | { kind: "children"; parentId: Id }
  | { kind: "search"; query: string; kinds?: Exclude<ObjectKind, "edge">[] };
export type IndexBrowsePageState = { complete: true; nextCursor: null } | { complete: false; nextCursor: string };
export type IndexBrowseListPage = { snapshot: IndexBrowseSnapshot; rows: IndexBrowseRow[]; coverage: Coverage } & IndexBrowsePageState;
export interface IndexBrowseFlowStep {
  edge: IndexBrowseRelation & { relation: "uses"; target: { objectId: Id } };
  implementation: IndexBrowseObject & { kind: "implementation" };
}
export type IndexBrowseDetailItem = { key: Id } & (
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
  snapshot: IndexBrowseSnapshot; object: IndexBrowseObject; items: IndexBrowseDetailItem[]; coverage: Coverage;
} & IndexBrowsePageState;
export type IndexBrowseSourcePage = {
  snapshot: IndexBrowseSnapshot; requestedSourceRefId: Id; sourceRef: SourceRef; text: string;
} & IndexBrowsePageState;
export type IndexBrowseResult<T> = { status: "ok"; value: T } |
  { status: "error"; error: { code: IndexErrorCode; retryable: boolean; message: string } };
export interface IndexBrowseNotice { version: 1; viewId: Id; sequence: number; reason: "changed" | "policy_changed" | "unavailable" }
export interface IndexAnnotationStep { edge: ObjectRevision; slot: string; implementation: ObjectRevision }
export type IndexAnnotationContext =
  | { kind: "feature"; feature: ObjectRevision }
  | { kind: "step"; feature: ObjectRevision; step: IndexAnnotationStep }
  | { kind: "flow"; feature: ObjectRevision; key: Id; flow: FlowAssertion; before: IndexAnnotationStep; after: IndexAnnotationStep };
export type IndexAnnotationTarget = IndexAnnotationContext | {
  kind: "source"; context: IndexAnnotationContext; requestedSourceRefId: Id; pageSourceRef: SourceRef; selection: SourceRef["range"];
};
export interface IndexAnnotationDraft {
  id: Id; owner: { workspaceId: Id; sessionId: Id | null }; snapshot: IndexBrowseSnapshot; target: IndexAnnotationTarget;
  fragment: { key: Id; start: number; end: number }; quote: string; text: string;
  intent: "change_code" | "correct_index" | "ask"; capturedFreshness: Freshness;
}
export type IndexAnnotationVerification = { id: Id; state: "current" | "changed" | "denied"; message: string };
export const indexBrowseScope = (viewId: string) => `index-view:${viewId}`;
export const indexProgressLabels: Record<IndexProgress["phase"], string> = {
  queued: "等待索引资源", querying: "检索已有索引", reading: "读取证据", analyzing: "分析关系",
  validating: "校验提案", committing: "提交索引", completed: "定位完成", failed: "定位失败",
  cancelled: "定位已停止", interrupted: "定位中断",
};
export function indexProgressSummary(progress: IndexProgress) {
  return `${indexProgressLabels[progress.phase]} · ${progress.modelRequestsStarted}次模型请求 · ${progress.evidencePages}页证据`;
}
