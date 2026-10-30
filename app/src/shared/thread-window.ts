import type { WindowFieldTarget, WindowFieldData, WindowFieldChunk } from "./window-frame-budget.js";
import type { RunOrigin, ChatMessage } from "./agent.js";

export const windowCollections = ["images", "attachments", "skills", "inputs"] as const;
export type WindowCollection = typeof windowCollections[number];

/** Partial windows never have the deletion semantics of the legacy messages scope. */
export type ThreadWindowQuery =
  | { op: "open" }
  | { op: "sources"; revision: string; before?: number; expectedStructure?: string }
  | { op: "segments"; revision: string; before?: number; expectedStructure?: string }
  | { op: "locate"; revision: string; key: string; before?: number }
  | { op: "members"; revision: string; sourceRef: string; before?: number; expectedStructure?: string }
  | { op: "calls"; revision: string; entityRef: string; before?: number; expectedStructure?: string }
  | { op: "describe"; revision: string; entityRef: string }
  | { op: "collection"; revision: string; entityRef: string; collection: WindowCollection; before?: number; expectedVersion?: string }
  | ({ op: "fieldInfo"; call?: number } & WindowFieldTarget)
  | ({ op: "field"; offsetCU?: number; call?: number; expectedVersion?: string } & WindowFieldTarget);
export interface WindowSourceDescriptor {
  ref: string;
  /** Stable within a storage bucket, NOT a read/action ref. */
  sourceKey: string;
  order: number;
  storage: "archive" | "live";
  segment: number | null;
  members: number;
  activity: boolean;
  delivery: boolean;
  folded: boolean;
  hasTasks: boolean;
  hideThinking: boolean;
  hasSelection: boolean;
}
export interface WindowMemberDescriptor {
  ref: string;
  /** Stable display identity, shared by all occurrences; NOT a read/action ref. */
  messageKey: string;
  occurrenceKey: string;
  order: number;
  role: "user" | "assistant" | "notice";
  ownerRunRef: string | null;
  ownerRunKey: string | null;
  last: boolean;
  thinking: boolean;
  body: "none" | "body" | "notice";
  outcome: boolean;
  calls: number;
}
export interface WindowSourcePage {
  kind: "sources";
  revision: string;
  /** Scope + host lifetime, not a native reset, body version or owner lease. */
  identityNamespace: string;
  /** Whole-cut topology only; not body freshness, owner validity or readiness. */
  structureVersion: string;
  total: number;
  /** Number of preceding sources; null proves the beginning of THIS snapshot. */
  previous: number | null;
  next: number | null;
  items: WindowSourceDescriptor[];
}
export interface WindowMemberPage {
  kind: "members";
  revision: string;
  sourceRef: string;
  total: number;
  previous: number | null;
  next: number | null;
  items: WindowMemberDescriptor[];
}
export interface WindowCallDescriptor {
  /** Only this bounded descriptor; full name/input/output use fieldInfo. */
  descriptorVersion: string;
  ref: string;
  callKey: string;
  order: number;
  /** Bounded preview. Read field=text on ref for the complete tool name. */
  name: { text: string; totalLengthCU: number; complete: boolean };
  inputLengthCU: number;
  /** Missing in this immutable cut, not proof that a result will never exist. */
  result: null | {
    ref: string;
    messageKey: string;
    status: "running" | "completed" | "failed" | "cancelled" | null;
    streaming: boolean;
    textLengthCU: number;
    toolStartedAt: number | null;
    durationMs: number | null;
  };
}
export interface WindowCallPage {
  kind: "calls";
  revision: string;
  entityRef: string;
  total: number;
  previous: number | null;
  next: number | null;
  /** Occurrence facts remain on the member; a calls-page end is not its end. */
  items: WindowCallDescriptor[];
}
export interface WindowSegmentPage {
  kind: "segments";
  revision: string;
  total: number;
  previous: number | null;
  next: number | null;
  items: {
    /** Only this bounded descriptor, not full title or summary content. */
    descriptorVersion: string;
    /** Checkpoint ref: field=text reads summary; field=metadata reads compression. */
    ref: string;
    messageKey: string;
    order: number;
    number: number;
    before: number;
    after: number | null;
    title: WindowCallDescriptor["name"];
    messageCount: number;
    /** Half-open ORIGINAL source range in this cut, never the summary itself. */
    sourceStart: number;
    sourceEnd: number;
    summaryLengthCU: number;
  }[];
}
/** Exact field content equality, not entity identity, topology or readiness. */
export interface WindowFieldInfo extends WindowFieldTarget {
  kind: "fieldInfo";
  version: string;
  lengthCU: number;
}
export interface WindowLocationPage {
  kind: "locations";
  revision: string;
  key: string;
  /** Zero means no eligible location in THIS cut, never global absence/readiness. */
  total: number;
  previous: number | null;
  next: number | null;
  items: {
    kind: "source" | "member" | "call" | "result" | "segment";
    ref: string;
    sourceRef: string | null;
    sourceOrder: number | null;
    memberOrder: number | null;
    callOrder: number | null;
    segmentOrder: number | null;
  }[];
}
export interface WindowMessageDescriptor {
  /** Bounded descriptor equality, not unpreviewed fields or collection contents. */
  descriptorVersion: string;
  kind: "message";
  revision: string;
  entityRef: string;
  messageKey: string;
  role: "user" | "assistant" | "notice";
  /** Null means this occurrence contributes no slot; previews are not full bodies. */
  text: WindowFieldChunk | null;
  thinking: WindowFieldChunk | null;
  status: "running" | "completed" | "failed" | "cancelled" | null;
  phase: "commentary" | "final_answer" | null;
  streaming: boolean;
  thinkingActive: boolean;
  runOrigin: RunOrigin | null;
  inputContinuation: boolean;
  hasError: boolean;
  hasSelection: boolean;
  hasCompression: boolean;
  hasDeliveryTiming: boolean;
  hasKiroFailure: boolean;
  collections: { calls: number; images: number; attachments: number; skills: number; inputs: number };
}
export interface WindowCollectionPage {
  /** Whole ordered allowed collection: identities + safe item metadata, not readiness. */
  version: string;
  kind: "collection";
  revision: string;
  entityRef: string;
  collection: WindowCollection;
  total: number;
  previous: number | null;
  next: number | null;
  items: { ref: string; order: number; label: WindowCallDescriptor["name"] | null;
    /** Input identity only, scoped to this snapshot; not an action or read-ready proof. */
    identityRef: string | null;
    /** Stable scope equality for inputs only; never an input action capability. */
    inputKey: string | null }[];
}
/** JSON-decoded field=metadata, never whole ChatMessage or embedded collections. */
export interface WindowMessageMetadata {
  compression: NonNullable<ChatMessage["compression"]> | null;
  kiroFailure: NonNullable<ChatMessage["kiroFailure"]> | null;
}
export type WindowCollectionMetadata =
  | { kind: "image"; name: string; mimeType: string; path: string | null }
  | { kind: "attachment"; name: string; attachmentKind: "file" | "image" | "folder" | null; path: string | null }
  | { kind: "skill"; name: string; description: string };
export type ThreadWindowData = WindowSourcePage | WindowMemberPage | WindowCallPage | WindowMessageDescriptor | WindowCollectionPage | WindowSegmentPage | WindowLocationPage | WindowFieldInfo | WindowFieldData;
export const WINDOW_FIELD_INFO_MAX_JSON_BYTES = 2 * 1024;
export const WINDOW_MESSAGE_MAX_JSON_BYTES = 4 * 1024;
export const WINDOW_PAGE_ITEMS = 64;
export const WINDOW_PAGE_MAX_JSON_BYTES = 128 * 1024;
