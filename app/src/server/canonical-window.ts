import { randomUUID } from "node:crypto";
import type { CanonicalSourceCapture } from "../shared/canonical-source-capture.js";
import type { Reply } from "../shared/protocol.js";
import { readRunOrigin, type SelectionChange } from "../shared/agent.js";
import { WINDOW_PAGE_ITEMS, WINDOW_PAGE_MAX_JSON_BYTES, WINDOW_MESSAGE_MAX_JSON_BYTES, WINDOW_FIELD_INFO_MAX_JSON_BYTES, windowCollections, type WindowCollection, type ThreadWindowQuery,
  type WindowSourcePage, type WindowMemberPage, type WindowCallPage, type WindowMessageDescriptor, type WindowCollectionPage, type WindowSegmentPage, type WindowLocationPage, type WindowFieldInfo, type WindowCallDescriptor } from "../shared/thread-window.js";
import { windowTextChunk } from "../shared/window-text-budget.js";
import { windowFieldReceipt, windowFieldErrorReceipt, WindowFrameBudgetError } from "../shared/window-frame-budget.js";

import { windowMessageMetadata, windowCollectionItems, windowCollectionMetadata } from "./canonical-window-metadata.js";
import { createWindowIdentity } from "./canonical-window-identity.js";
import { windowStructure } from "./canonical-window-structure.js";
import { windowLocations, windowLocation } from "./canonical-window-locations.js";
import { windowMessageVersion, windowCallVersion, windowSegmentVersion, windowCollectionVersion } from "./canonical-window-versions.js";

type Snapshot = { capture: CanonicalSourceCapture; structure: ReturnType<typeof windowStructure>;
  runs: Map<string, string>; inputs: Map<string, string>;
  segmentRanges?: { start: number; end: number }[]; locations?: ReturnType<typeof windowLocations>; fieldVersions?: Map<string, string>; collectionVersions?: Map<string, string> };
const token = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
const fail = (code: ConstructorParameters<typeof WindowFrameBudgetError>[0]): never => { throw new WindowFrameBudgetError(code); };
const requestIdValid = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 200 && id.trim() === id && !id.includes("\0");
function query(value: unknown): ThreadWindowQuery {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("INVALID_REFERENCE");
  const item = value as Record<string, unknown>;
  const keys = item.op === "open" ? ["op"] : item.op === "sources" || item.op === "segments" ? ["op", "revision", "before", "expectedStructure"]
    : item.op === "locate" ? ["op", "revision", "key", "before"]
    : item.op === "members" ? ["op", "revision", "sourceRef", "before", "expectedStructure"]
    : item.op === "calls" ? ["op", "revision", "entityRef", "before", "expectedStructure"]
    : item.op === "describe" ? ["op", "revision", "entityRef"]
    : item.op === "collection" ? ["op", "revision", "entityRef", "collection", "before", "expectedVersion"]
    : item.op === "fieldInfo" ? ["op", "revision", "entityRef", "field", "call"]
    : item.op === "field" ? ["op", "revision", "entityRef", "field", "offsetCU", "call", "expectedVersion"] : [];
  if (!keys.length || Object.keys(item).some(key => !keys.includes(key))) return fail("INVALID_REFERENCE");
  if (item.op !== "open" && !token(item.revision)) return fail("INVALID_REFERENCE");
  if (item.expectedStructure !== undefined && !token(item.expectedStructure)) return fail("INVALID_REFERENCE");
  if (item.op === "locate" && (typeof item.key !== "string" || !/^k_[A-Za-z0-9_-]{43}$/.test(item.key))) return fail("INVALID_REFERENCE");
  if (item.expectedVersion !== undefined && !token(item.expectedVersion)) return fail("INVALID_REFERENCE");
  if (item.op === "members" && !token(item.sourceRef) || (item.op === "field" || item.op === "fieldInfo" || item.op === "calls" || item.op === "describe" || item.op === "collection") && !token(item.entityRef)) return fail("INVALID_REFERENCE");
  for (const key of ["before", "offsetCU", "call"]) if (item[key] !== undefined &&
    (!Number.isSafeInteger(item[key]) || (item[key] as number) < 0)) return fail("INVALID_OFFSET");
  if (item.op === "collection" && !windowCollections.includes(item.collection as WindowCollection)) return fail("INVALID_REFERENCE");
  if ((item.op === "field" || item.op === "fieldInfo") && (typeof item.field !== "string" || !["text", "thinking", "input", "error", "selection", "metadata"].includes(item.field))) return fail("INVALID_FIELD");
  if ((item.op === "field" || item.op === "fieldInfo") && item.field !== "input" && item.call !== undefined) return fail("INVALID_REFERENCE");
  return item as ThreadWindowQuery;
}
const selectionText = (change: SelectionChange | undefined) => change ? JSON.stringify({
  from: { provider: change.from.provider, id: change.from.id, thinking: change.from.thinking },
  to: { provider: change.to.provider, id: change.to.id, thinking: change.to.thinking },
}) : "null";
const preview = (text: string) => {
  const { encodedBytes: _bytes, ...chunk } = windowTextChunk(text, 512);
  return chunk;
};
const nonnegative = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const range = (total: number, before: number | undefined) => {
  const end = before ?? total;
  if (end > total) return fail("INVALID_OFFSET");
  return { start: Math.max(0, end - WINDOW_PAGE_ITEMS), end };
};

/** Per native-file cut or live run owner, not a process-global registry. Raw IDs
 * stay internal even if they are huge or contain delimiters. Paging uses complete
 * captured source facts; it never rebuilds grouping from a sliced message list.
 * At most two immutable captures are retained. Their O(N) construction/storage is
 * NOT a memory bound; these are wire-bounded query results, not a virtualized UI.
 */
export class CanonicalWindow {
  private snapshots = new Map<string, Snapshot>();
  private active = true;
  private readonly identity: ReturnType<typeof createWindowIdentity>;
  constructor(private readonly capture: () => CanonicalSourceCapture | undefined, private readonly current: () => boolean = () => true,
    identitySeed?: string) { this.identity = createWindowIdentity(identitySeed); }
  close() { this.active = false; this.snapshots.clear(); }
  read(requestId: unknown, input: unknown): Reply {
    try {
      if (!requestIdValid(requestId)) return windowFieldErrorReceipt(requestId, "INVALID_REQUEST_ID").frame;
      if (!this.active || !this.current()) { this.close(); return fail("STALE"); }
      const operation = query(input);
      let revision: string;
      if (operation.op === "open") {
        const capture = this.capture();
        if (!capture) return fail("UNAVAILABLE");
        revision = randomUUID();
        this.snapshots.set(revision, { capture, structure: windowStructure(capture, this.identity), runs: new Map(), inputs: new Map() });
        while (this.snapshots.size > 2) this.snapshots.delete(this.snapshots.keys().next().value!);
      } else revision = operation.revision;
      const snapshot = this.snapshots.get(revision);
      if (!snapshot) return fail("STALE");
      const { capture, structure } = snapshot;
      if ("expectedStructure" in operation && operation.expectedStructure !== undefined && operation.expectedStructure !== structure.version)
        return fail("STALE");
      if (operation.op === "open" || operation.op === "sources") {
        const { start, end } = range(capture.sources.length, operation.op === "sources" ? operation.before : undefined);
        const data: WindowSourcePage = { kind: "sources", revision, identityNamespace: this.identity.namespace, structureVersion: structure.version, total: capture.sources.length,
          previous: start || null, next: end < capture.sources.length ? Math.min(capture.sources.length, end + WINDOW_PAGE_ITEMS) : null,
          items: capture.sources.slice(start, end).map((source, offset) => ({ ref: `${revision}_s_${start + offset}`, sourceKey: structure.sourceKeys[start + offset], order: start + offset,
            storage: source.storage.kind, segment: source.storage.kind === "archive" ? source.storage.segmentOrder : null,
            members: source.group.ids.length, activity: source.group.activity === true, delivery: source.group.delivery === true,
            folded: source.group.folded === true, hasTasks: source.group.hasTasks === true, hideThinking: source.group.hideThinking === true,
            hasSelection: !!source.group.selectionChange })) };
        return this.page(requestId, data);
      }
      if (operation.op === "segments") {
        // Once per immutable cut, not one full source scan per directory item.
        if (!snapshot.segmentRanges) {
          let cursor = 0;
          const ranges = capture.archive.segments.map((_, order) => {
            const start = cursor;
            while (cursor < capture.sources.length) {
              const storage = capture.sources[cursor].storage;
              if (storage.kind !== "archive" || storage.segmentOrder !== order) break;
              cursor++;
            }
            return { start, end: cursor };
          });
          if (capture.sources[cursor]?.storage.kind === "archive") return fail("UNAVAILABLE");
          snapshot.segmentRanges = ranges;
        }
        const total = capture.archive.segments.length, { start, end } = range(total, operation.before);
        const data: WindowSegmentPage = { kind: "segments", revision, total, previous: start || null,
          next: end < total ? Math.min(total, end + WINDOW_PAGE_ITEMS) : null, items: [] };
        for (let i = start; i < end; i++) {
          const segment = capture.archive.segments[i], summary = capture.message(segment.id);
          if (!summary?.compression) return fail("UNAVAILABLE");
          const chunk = windowTextChunk(segment.compression.title, 64);
          const title = { text: chunk.text, totalLengthCU: chunk.totalLengthCU, complete: chunk.nextOffsetCU === null };
          if (Buffer.byteLength(JSON.stringify(title)) > 128) return fail("INTERNAL_FRAME_BUDGET");
          const sources = snapshot.segmentRanges[i];
          const descriptor: Omit<WindowSegmentPage["items"][number], "descriptorVersion"> = { ref: `${revision}_h_${i}`, messageKey: this.identity.key("message", segment.id), order: i, number: segment.compression.number,
            before: segment.compression.before, after: segment.compression.after, title,
            messageCount: segment.messageIds.length, sourceStart: sources.start, sourceEnd: sources.end, summaryLengthCU: summary.text.length };
          data.items.push({ ...descriptor, descriptorVersion: windowSegmentVersion(descriptor, this.identity) });
        }
        return this.page(requestId, data);
      }
      if (operation.op === "locate") {
        snapshot.locations ??= windowLocations(capture, structure, this.identity);
        const locations = snapshot.locations.get(operation.key) ?? [], total = locations.length, { start, end } = range(total, operation.before);
        const data: WindowLocationPage = { kind: "locations", revision, key: operation.key, total, previous: start || null,
          next: end < total ? Math.min(total, end + WINDOW_PAGE_ITEMS) : null,
          items: locations.slice(start, end).map(position => windowLocation(position, revision, capture)) };
        return this.page(requestId, data);
      }
      const ref = operation.op === "members" ? operation.sourceRef : operation.entityRef;
      const suffix = ref.startsWith(revision + "_") ? ref.slice(revision.length + 1) : "";
      const checkpoint = /^h_(0|[1-9]\d*)$/.exec(suffix);
      if (checkpoint) {
        const order = Number(checkpoint[1]), segment = capture.archive.segments[order];
        if (!Number.isSafeInteger(order) || !segment || operation.op !== "field" && operation.op !== "fieldInfo" ||
          operation.field !== "text" && operation.field !== "metadata") return fail("INVALID_REFERENCE");
        const message = capture.message(segment.id);
        if (!message?.compression) return fail("UNAVAILABLE");
        const value = operation.field === "text" ? message.text : JSON.stringify(windowMessageMetadata(message));
        return this.field(requestId, operation, snapshot, operation.entityRef, value);
      }
      const match = /^(s|m)_(0|[1-9]\d*)(?:_(0|[1-9]\d*))?(?:_c_(0|[1-9]\d*)(?:_(r))?|_a_(images|attachments|skills|inputs)_(0|[1-9]\d*))?$/.exec(suffix);
      if (!match || match[5] !== undefined && match[4] === undefined) return fail("INVALID_REFERENCE");
      const sourceOrder = Number(match[2]), source = capture.sources[sourceOrder];
      if (!Number.isSafeInteger(sourceOrder) || !source) return fail("INVALID_REFERENCE");
      if (operation.op === "members") {
        if (match[1] !== "s" || match[3] !== undefined || match[4] !== undefined || match[6] !== undefined) return fail("INVALID_REFERENCE");
        const { start, end } = range(source.group.ids.length, operation.before);
        const data: WindowMemberPage = { kind: "members", revision, sourceRef: operation.sourceRef, total: source.group.ids.length,
          previous: start || null, next: end < source.group.ids.length ? Math.min(source.group.ids.length, end + WINDOW_PAGE_ITEMS) : null, items: [] };
        for (let i = start; i < end; i++) {
          const fact = capture.occurrences.get(source.sourceKey, i);
          if (!fact) return fail("UNAVAILABLE");
          const message = capture.message(fact.messageId);
          if (!message || !["user", "assistant", "notice"].includes(message.role)) return fail("UNAVAILABLE");
          let ownerRunRef: string | null = null;
          if (fact.ownerRunId !== null) {
            ownerRunRef = snapshot.runs.get(fact.ownerRunId) ?? `${revision}_r_${snapshot.runs.size}`;
            snapshot.runs.set(fact.ownerRunId, ownerRunRef);
          }
          data.items.push({ ref: `${revision}_m_${sourceOrder}_${i}`, messageKey: this.identity.key("message", fact.messageId),
            occurrenceKey: this.identity.key("occurrence", JSON.stringify([structure.sourceKeys[sourceOrder], fact.messageId])), order: i, role: message.role as "user" | "assistant" | "notice",
            ownerRunRef, ownerRunKey: fact.ownerRunId === null ? null : this.identity.key("run", fact.ownerRunId), last: fact.isLastForMessage, thinking: fact.shape.thinking, body: fact.shape.body,
            outcome: fact.shape.outcome, calls: fact.shape.callsCount });
        }
        return this.page(requestId, data);
      }
      if (match[1] === "s" && match[3] === undefined && match[4] === undefined && match[6] === undefined &&
        (operation.op === "field" || operation.op === "fieldInfo") && operation.field === "selection")
        return this.field(requestId, operation, snapshot, operation.entityRef, selectionText(source.group.selectionChange));
      if (match[1] !== "m" || match[3] === undefined) return fail("INVALID_REFERENCE");
      const member = Number(match[3]), id = source.group.ids[member], message = id === undefined ? undefined : capture.message(id);
      if (!Number.isSafeInteger(member) || !message) return fail("INVALID_REFERENCE");
      const fact = capture.occurrences.get(source.sourceKey, member);
      if (!fact) return fail("UNAVAILABLE");
      const hasBody = fact.shape.body !== "none";
      if (match[6] !== undefined) {
        if (operation.op !== "field" && operation.op !== "fieldInfo" || operation.field !== "metadata" || !hasBody) return fail("INVALID_REFERENCE");
        const index = Number(match[7]);
        if (!Number.isSafeInteger(index)) return fail("INVALID_REFERENCE");
        const metadata = windowCollectionMetadata(message, match[6] as WindowCollection, index);
        if (!metadata) return fail("INVALID_REFERENCE");
        return this.field(requestId, operation, snapshot, operation.entityRef, JSON.stringify(metadata));
      }
      if (operation.op === "collection") {
        if (match[4] !== undefined) return fail("INVALID_REFERENCE");
        const collection = operation.collection, items = hasBody ? windowCollectionItems(message, collection) : [];
        const versions = snapshot.collectionVersions ??= new Map<string, string>(), key = `${operation.entityRef}:${collection}`;
        let version = versions.get(key);
        if (version === undefined) { version = windowCollectionVersion(message, collection, hasBody, this.identity); versions.set(key, version); }
        if (operation.expectedVersion !== undefined && operation.expectedVersion !== version) return fail("STALE");
        const { start, end } = range(items.length, operation.before);
        const data: WindowCollectionPage = { kind: "collection", revision, entityRef: operation.entityRef, collection, version,
          total: items.length, previous: start || null, next: end < items.length ? Math.min(items.length, end + WINDOW_PAGE_ITEMS) : null, items: [] };
        for (let i = start; i < end; i++) {
          const item = items[i];
          let label: WindowCollectionPage["items"][number]["label"] = null, identityRef: string | null = null;
          if (typeof item === "string") {
            identityRef = snapshot.inputs.get(item) ?? `${revision}_i_${snapshot.inputs.size}`;
            snapshot.inputs.set(item, identityRef);
          } else {
            const chunk = windowTextChunk(item.name, 64);
            label = { text: chunk.text, totalLengthCU: chunk.totalLengthCU, complete: chunk.nextOffsetCU === null };
            if (Buffer.byteLength(JSON.stringify(label)) > 128) return fail("INTERNAL_FRAME_BUDGET");
          }
          data.items.push({ ref: `${operation.entityRef}_a_${collection}_${i}`, order: i, label, identityRef,
            inputKey: typeof item === "string" ? this.identity.key("input", item) : null });
        }
        return this.page(requestId, data);
      }
      if (operation.op === "describe") {
        if (match[4] !== undefined || !["user", "assistant", "notice"].includes(message.role)) return fail("INVALID_REFERENCE");
        const data: Omit<WindowMessageDescriptor, "descriptorVersion"> = { kind: "message", revision, entityRef: operation.entityRef, messageKey: this.identity.key("message", id),
          role: message.role as WindowMessageDescriptor["role"],
          text: fact.shape.body === "none" ? null : preview(message.text),
          thinking: fact.shape.thinking ? preview(message.thinking ?? "") : null,
          status: message.status && ["running", "completed", "failed", "cancelled"].includes(message.status) ? message.status : null,
          phase: message.phase === "commentary" || message.phase === "final_answer" ? message.phase : null,
          streaming: message.streaming === true, thinkingActive: message.thinkingActive === true,
          runOrigin: readRunOrigin(message.runOrigin) ?? null, inputContinuation: message.inputContinuation === true,
          hasError: !!message.error, hasSelection: !!message.selectionChange, hasCompression: !!message.compression,
          hasDeliveryTiming: !!message.deliveryTiming, hasKiroFailure: !!message.kiroFailure,
          collections: { calls: fact.shape.callsCount, images: hasBody ? message.images?.length ?? 0 : 0,
            attachments: hasBody ? message.attachments?.length ?? 0 : 0, skills: hasBody ? message.skills?.length ?? 0 : 0,
            inputs: hasBody ? message.inputIds?.length ?? 0 : 0 } };
        return this.page(requestId, { ...data, descriptorVersion: windowMessageVersion(data, this.identity) }, WINDOW_MESSAGE_MAX_JSON_BYTES);
      }
      if (operation.op === "calls") {
        if (match[4] !== undefined) return fail("INVALID_REFERENCE");
        const total = fact.shape.callsCount, { start, end } = range(total, operation.before);
        const data: WindowCallPage = { kind: "calls", revision, entityRef: operation.entityRef, total,
          previous: start || null, next: end < total ? Math.min(total, end + WINDOW_PAGE_ITEMS) : null, items: [] };
        for (let i = start; i < end; i++) {
          const call = message.calls?.[i];
          if (!call) return fail("UNAVAILABLE");
          const ref = `${operation.entityRef}_c_${i}`, preview = windowTextChunk(call.name, 64);
          const name = { text: preview.text, totalLengthCU: preview.totalLengthCU, complete: preview.nextOffsetCU === null };
          // <=128 bytes per preview, hence <=8KiB over all 64 descriptors.
          if (Buffer.byteLength(JSON.stringify(name)) > 128) return fail("INTERNAL_FRAME_BUDGET");
          const result = capture.message(`tool-${call.id}`);
          if (result && result.role !== "toolResult") return fail("UNAVAILABLE");
          const descriptor: Omit<WindowCallDescriptor, "descriptorVersion"> = { ref, callKey: this.identity.key("call", call.id), order: i, name, inputLengthCU: call.input.length, result: result ? {
            ref: `${ref}_r`, messageKey: this.identity.key("message", result.id), status: result.status && ["running", "completed", "failed", "cancelled"].includes(result.status) ? result.status : null,
            streaming: result.streaming === true, textLengthCU: result.text.length,
            toolStartedAt: nonnegative(result.toolStartedAt), durationMs: nonnegative(result.durationMs),
          } : null };
          data.items.push({ ...descriptor, descriptorVersion: windowCallVersion(descriptor, this.identity) });
        }
        return this.page(requestId, data);
      }
      const call = match[4] === undefined ? operation.call : Number(match[4]);
      if (call !== undefined && (!Number.isSafeInteger(call) || call >= fact.shape.callsCount || !message.calls?.[call]) ||
        match[4] !== undefined && operation.call !== undefined) return fail("INVALID_REFERENCE");
      if (match[4] === undefined && (operation.field === "text" && fact.shape.body === "none" ||
        operation.field === "thinking" && !fact.shape.thinking)) return fail("INVALID_REFERENCE");
      let entityRef = operation.entityRef, value: string;
      if (match[5] !== undefined) {
        if (operation.field !== "text") return fail("INVALID_REFERENCE");
        const result = capture.message(`tool-${message.calls![call!].id}`);
        if (!result || result.role !== "toolResult") return fail("UNAVAILABLE");
        value = result.text;
      } else if (operation.field === "input") {
        if (call === undefined) return fail("INVALID_REFERENCE");
        value = message.calls![call].input;
        if (match[4] === undefined) entityRef = `${entityRef}_c_${call}`;
      } else if (match[4] !== undefined) {
        if (operation.field !== "text") return fail("INVALID_REFERENCE");
        value = message.calls![call!].name;
      } else value = operation.field === "text" ? message.text : operation.field === "thinking" ? message.thinking ?? ""
        : operation.field === "error" ? message.error ?? "" : operation.field === "metadata" ? JSON.stringify(windowMessageMetadata(message))
        : selectionText(message.selectionChange);
      return this.field(requestId, operation, snapshot, entityRef, value);
    } catch (error) {
      return windowFieldErrorReceipt(requestId, error instanceof WindowFrameBudgetError ? error.code : "UNAVAILABLE").frame;
    }
  }
  private field(requestId: string, operation: Extract<ThreadWindowQuery, { op: "field" | "fieldInfo" }>, snapshot: Snapshot, entityRef: string, value: string): Reply {
    const { revision, field } = operation;
    if (operation.op === "fieldInfo" || operation.expectedVersion !== undefined) {
      const versions = snapshot.fieldVersions ??= new Map<string, string>(), key = `${entityRef}:${field}`;
      // Exact immutable field only, lazy and cached per cut. Hashing/metadata
      // encoding is O(field bytes), NOT a CPU or allocation bound.
      let version = versions.get(key);
      if (version === undefined) { version = this.identity.version("field-v1", [field, value]); versions.set(key, version); }
      if (operation.op === "fieldInfo") return this.page(requestId, { kind: "fieldInfo", revision, entityRef, field, version, lengthCU: value.length }, WINDOW_FIELD_INFO_MAX_JSON_BYTES);
      if (operation.expectedVersion !== undefined && operation.expectedVersion !== version) return fail("STALE");
    }
    return windowFieldReceipt(requestId, { revision, entityRef, field }, value, undefined, operation.offsetCU).frame;
  }
  private page(requestId: string, data: WindowSourcePage | WindowMemberPage | WindowCallPage | WindowMessageDescriptor | WindowCollectionPage | WindowSegmentPage | WindowLocationPage | WindowFieldInfo,
    budget = WINDOW_PAGE_MAX_JSON_BYTES): Reply {
    const frame: Reply = { type: "receipt", requestId, ok: true, data };
    // Only constructed primitive metadata and capped arrays are serialized here;
    // no full ChatMessage/group or unbounded raw identifier is ever a candidate.
    if (Buffer.byteLength(JSON.stringify(frame)) > budget) return fail("INTERNAL_FRAME_BUDGET");
    return frame;
  }
}
