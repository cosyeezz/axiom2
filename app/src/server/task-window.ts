import { randomUUID } from "node:crypto";
import type { Reply } from "../shared/protocol.js";
import { TASK_WINDOW_MEMBERSHIP_ITEMS } from "../shared/task-window.js";
import type { TaskWindowData, TaskWindowField, TaskWindowQuery, WindowTaskDestination, WindowTaskInputPage, WindowTaskLocation, WindowTaskPage, WindowTaskResultPage, WindowTaskResultRefPage } from "../shared/task-window.js";
import { WINDOW_FIELD_INFO_MAX_JSON_BYTES, WINDOW_MESSAGE_MAX_JSON_BYTES, WINDOW_PAGE_ITEMS, WINDOW_PAGE_MAX_JSON_BYTES, type WindowFieldInfo } from "../shared/thread-window.js";
import { validRequestId, WindowFrameBudgetError, windowFieldErrorReceipt, windowFieldReceipt } from "../shared/window-frame-budget.js";
import { WindowTextBudgetError } from "../shared/window-text-budget.js";
import { createWindowIdentity } from "./canonical-window-identity.js";
import { taskWindowMetadata, type TaskWindowPosition } from "./task-window-metadata.js";
import type { TaskWindowSource, TaskWindowSourceTask } from "./task-window-source.js";
import type { TaskWindowReport } from "./task-window-report.js";

type Snapshot = { source: TaskWindowSource; metadata: ReturnType<typeof taskWindowMetadata>; fieldVersions: Map<string, string>;
  reports: Map<string, TaskWindowReport>; reportFingerprints: Map<string, string> };
const fail = (code: ConstructorParameters<typeof WindowFrameBudgetError>[0]): never => { throw new WindowFrameBudgetError(code); };
const token = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
const key = (value: unknown) => typeof value === "string" && /^k_[A-Za-z0-9_-]{43}$/.test(value);
/** Strict primitives and at most 32 two-token membership pairs fit below 16KiB.
 * Never stringify unknown extras/toJSON or truncate raw IDs into other IDs. */
function query(value: unknown): TaskWindowQuery {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("INVALID_REFERENCE");
  const item = value as Record<string, unknown>;
  const allowed = item.op === "open" ? ["op", "anchorKey"]
    : item.op === "tasks" ? ["op", "revision", "anchorKey", "anchor", "before", "expectedVersion"]
    : item.op === "target" ? ["op", "revision", "taskRef"]
    : item.op === "results" || item.op === "inputs" ? ["op", "revision", "taskRef", "before", "expectedVersion"]
    : item.op === "resultRefs" ? ["op", "revision", "before", "expectedVersion"]
    : item.op === "hasResults" ? ["op", "revision", "references"]
    : item.op === "locate" ? ["op", "revision", "key"]
    : item.op === "lookup" ? ["op", "revision", "kind", "reference"]
    : item.op === "fieldInfo" ? ["op", "revision", "entityRef", "field"]
    : item.op === "field" ? ["op", "revision", "entityRef", "field", "offsetCU", "expectedVersion"] : [];
  if (!allowed.length || Object.keys(item).some(name => !allowed.includes(name))) return fail("INVALID_REFERENCE");
  if (item.op !== "open" && !token(item.revision)) return fail("INVALID_REFERENCE");
  if (item.anchorKey !== undefined && !key(item.anchorKey) || item.op === "locate" && !key(item.key)) return fail("INVALID_REFERENCE");
  if (item.expectedVersion !== undefined && !token(item.expectedVersion)) return fail("INVALID_REFERENCE");
  if (item.anchor !== undefined && (!token(item.anchor) || item.anchorKey !== undefined)) return fail("INVALID_REFERENCE");
  if ((item.op === "results" || item.op === "inputs" || item.op === "target") && !token(item.taskRef)) return fail("INVALID_REFERENCE");
  if (item.op === "lookup" && (item.kind !== "task" && item.kind !== "input" || !token(item.reference))) return fail("INVALID_REFERENCE");
  if (item.op === "hasResults") {
    const refs = item.references;
    if (!Array.isArray(refs) || !refs.length || refs.length > TASK_WINDOW_MEMBERSHIP_ITEMS || Object.keys(refs).length !== refs.length) return fail("INVALID_REFERENCE");
    for (const ref of refs) {
      if (!ref || typeof ref !== "object" || Array.isArray(ref) || Object.keys(ref).length !== 2 ||
          Object.keys(ref).some(name => name !== "taskId" && name !== "resultId") || !token(ref.taskId) || !token(ref.resultId)) return fail("INVALID_REFERENCE");
    }
  }
  for (const name of ["before", "offsetCU"]) if (item[name] !== undefined && (!Number.isSafeInteger(item[name]) || (item[name] as number) < 0)) return fail("INVALID_OFFSET");
  if (item.op === "field" || item.op === "fieldInfo") {
    if (!token(item.entityRef)) return fail("INVALID_REFERENCE");
    if (typeof item.field !== "string" || !["text", "input", "error", "metadata"].includes(item.field)) return fail("INVALID_FIELD");
  }
  return item as TaskWindowQuery;
}
const taskRef = (revision: string, order: number) => `${revision}_t_${order}`;
function entityRef(revision: string, at: TaskWindowPosition) {
  const task = taskRef(revision, at.taskOrder);
  return at.kind === "task" ? task : `${task}_${at.kind === "result" ? "r" : "i"}_${at.itemOrder}`;
}
function position(revision: string, ref: string, source: TaskWindowSource): TaskWindowPosition {
  const match = /^(0|[1-9]\d*)(?:_(r|i)_(0|[1-9]\d*))?$/.exec(ref.startsWith(`${revision}_t_`) ? ref.slice(revision.length + 3) : "");
  if (!match) return fail("INVALID_REFERENCE");
  const taskOrder = Number(match[1]), task = source.tasks[taskOrder];
  if (!Number.isSafeInteger(taskOrder) || !task) return fail("INVALID_REFERENCE");
  if (!match[2]) return { kind: "task", taskOrder, itemOrder: null };
  const itemOrder = Number(match[3]), kind = match[2] === "r" ? "result" : "input";
  if (!Number.isSafeInteger(itemOrder) || !(kind === "result" ? task.results : task.inputs)[itemOrder]) return fail("INVALID_REFERENCE");
  return { kind, taskOrder, itemOrder };
}
function range(total: number, before?: number) {
  const end = before ?? total;
  if (end > total) return fail("INVALID_OFFSET");
  const start = Math.max(0, end - WINDOW_PAGE_ITEMS);
  return { start, end, total, previous: start || null, next: end < total ? Math.min(total, end + WINDOW_PAGE_ITEMS) : null };
}
function guard(expected: string | undefined, actual: string) { if (expected !== undefined && expected !== actual) return fail("STALE"); }
function fieldText(source: TaskWindowSource, at: TaskWindowPosition, field: TaskWindowField): string {
  const task = source.tasks[at.taskOrder];
  // Results use the separately owned lazy report path. A result ref must never
  // fall through to the parent task's fields.
  if (at.kind === "result" || at.kind === "input" && field !== "error") return fail("UNAVAILABLE");
  const value = at.kind === "input" ? task.inputs[at.itemOrder!].error ?? ""
    : field === "text" ? task.description : field === "input" ? task.context ?? "" : field === "error" ? task.error ?? ""
    : JSON.stringify({ title: task.title ?? null, modelRef: task.ref ?? null });
  return typeof value === "string" ? value : fail("INVALID_TEXT");
}

/** Scope-owned host reader. At most two immutable SQL captures, independently of
 * transcript cuts. Wire-bounded replies, NOT bounded capture CPU/RSS, UI partial
 * storage, navigation authority or a read-ready/tail acknowledgement. */
export class TaskWindow {
  private active = true;
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly identity: ReturnType<typeof createWindowIdentity>;
  constructor(private readonly capture: () => TaskWindowSource | undefined, private readonly current: () => boolean = () => true, identitySeed?: string,
    private readonly target?: (task: TaskWindowSourceTask) => WindowTaskDestination,
    private readonly report?: (task: TaskWindowSourceTask, result: TaskWindowSourceTask["results"][number]) => TaskWindowReport) {
    this.identity = createWindowIdentity(identitySeed);
  }
  close() { this.active = false; this.snapshots.clear(); }
  private owned() {
    try { if (this.active && this.current()) return; } catch { /* Lost owner is terminal, including a throwing guard. */ }
    this.close(); return fail("STALE");
  }
  read(requestId: unknown, input: unknown): Reply {
    try {
      if (!validRequestId(requestId)) return windowFieldErrorReceipt(requestId, "INVALID_REQUEST_ID").frame;
      this.owned();
      const operation = query(input);
      let revision: string;
      if (operation.op === "open") {
        const source = this.capture();
        if (!source) return fail("UNAVAILABLE");
        const metadata = taskWindowMetadata(source, this.identity);
        this.owned(); // SQL can have outside writers while a synchronous capture runs.
        revision = randomUUID();
        this.snapshots.set(revision, { source, metadata, fieldVersions: new Map(), reports: new Map(), reportFingerprints: new Map() });
        while (this.snapshots.size > 2) this.snapshots.delete(this.snapshots.keys().next().value!);
      } else revision = operation.revision;
      const snapshot = this.snapshots.get(revision);
      if (!snapshot) return fail("STALE");
      const { source, metadata: meta } = snapshot;
      if (operation.op === "open" || operation.op === "tasks") {
        // Transitional legacy ToolCall IDs are already host-normalized. Derive
        // only a display filter here; this does not grant a field/action ref.
        const anchorKey = operation.op === "tasks" && operation.anchor !== undefined ? this.identity.key("call", operation.anchor) : operation.anchorKey;
        const collection = anchorKey === undefined ? meta.all : meta.groups.get(anchorKey) ?? meta.empty;
        if (operation.op === "tasks") guard(operation.expectedVersion, collection.version);
        const { start, end, ...pagination } = range(collection.orders.length, operation.op === "tasks" ? operation.before : undefined);
        const data: WindowTaskPage = { kind: "tasks", revision, identityNamespace: this.identity.namespace, anchorKey: anchorKey ?? null,
          ...pagination, version: collection.version, counts: collection.counts, state: meta.state,
          items: collection.orders.slice(start, end).map(order => ({ ...meta.tasks[order], ref: taskRef(revision, order) })) };
        for (const item of data.items) if (Buffer.byteLength(JSON.stringify(item)) > WINDOW_MESSAGE_MAX_JSON_BYTES) return fail("INTERNAL_FRAME_BUDGET");
        return this.frame(requestId, data);
      }
      if (operation.op === "hasResults") {
        const matched = operation.references.every(ref => {
          const order = meta.taskOrders.get(ref.taskId);
          return order !== undefined && meta.resultOrders[order].has(ref.resultId);
        });
        return this.frame(requestId, { kind: "membership", revision, matched }, WINDOW_FIELD_INFO_MAX_JSON_BYTES);
      }
      if (operation.op === "target") {
        const at = position(revision, operation.taskRef, source);
        if (at.kind !== "task") return fail("INVALID_REFERENCE");
        if (!this.target) return fail("UNAVAILABLE");
        const { taskId, sessionId, initialInputId } = this.target(source.tasks[at.taskOrder]);
        if (!token(taskId) || !token(sessionId) || initialInputId !== null && !token(initialInputId)) return fail("UNAVAILABLE");
        return this.frame(requestId, { kind: "target", revision, taskRef: operation.taskRef, taskId, sessionId, initialInputId }, WINDOW_MESSAGE_MAX_JSON_BYTES);
      }
      if (operation.op === "resultRefs") {
        guard(operation.expectedVersion, meta.state.resultRefs.version);
        const { start, end, ...pagination } = range(meta.resultRefs.length, operation.before);
        const data: WindowTaskResultRefPage = { kind: "resultRefs", revision, ...pagination, version: meta.state.resultRefs.version, state: meta.state,
          items: meta.resultRefs.slice(start, end).map(ref => ({ ...ref.data, taskRef: taskRef(revision, ref.taskOrder),
            resultRef: entityRef(revision, { kind: "result", taskOrder: ref.taskOrder, itemOrder: ref.resultOrder }) })) };
        return this.frame(requestId, data);
      }
      if (operation.op === "locate" || operation.op === "lookup") {
        const at = operation.op === "locate" ? meta.locations.get(operation.key)
          : (operation.kind === "task" ? meta.taskReferences : meta.inputReferences).get(operation.reference);
        const data: WindowTaskLocation = { kind: "location", revision, location: at ? { ...at, ref: entityRef(revision, at), taskRef: taskRef(revision, at.taskOrder) } : null };
        return this.frame(requestId, data, WINDOW_MESSAGE_MAX_JSON_BYTES);
      }
      if (operation.op === "results" || operation.op === "inputs") {
        const at = position(revision, operation.taskRef, source);
        if (at.kind !== "task") return fail("INVALID_REFERENCE");
        const collection = meta.tasks[at.taskOrder][operation.op];
        guard(operation.expectedVersion, collection.version);
        const { start, end, ...pagination } = range(collection.total, operation.before);
        if (operation.op === "results") {
          const data: WindowTaskResultPage = { kind: "results", revision, taskRef: operation.taskRef, ...pagination, version: collection.version,
            items: meta.results[at.taskOrder].slice(start, end).map(item => ({ ...item, ref: entityRef(revision, { kind: "result", taskOrder: at.taskOrder, itemOrder: item.order }) })) };
          return this.frame(requestId, data);
        }
        const data: WindowTaskInputPage = { kind: "inputs", revision, taskRef: operation.taskRef, ...pagination, version: collection.version,
          items: meta.inputs[at.taskOrder].slice(start, end).map(item => ({ ...item, ref: entityRef(revision, { kind: "input", taskOrder: at.taskOrder, itemOrder: item.order }) })) };
        return this.frame(requestId, data);
      }
      const at = position(revision, operation.entityRef, source);
      const value = at.kind === "result" ? this.reportField(snapshot, at, operation.field) : fieldText(source, at, operation.field);
      const cacheKey = `${operation.entityRef}:${operation.field}`;
      if (operation.op === "fieldInfo" || operation.expectedVersion !== undefined) {
        const version = snapshot.fieldVersions.get(cacheKey) ?? this.identity.version("task-field-v1", [operation.field, value]);
        snapshot.fieldVersions.set(cacheKey, version);
        if (operation.op === "fieldInfo") {
          const data: WindowFieldInfo = { kind: "fieldInfo", revision, entityRef: operation.entityRef, field: operation.field, version, lengthCU: value.length };
          return this.frame(requestId, data, WINDOW_FIELD_INFO_MAX_JSON_BYTES);
        }
        guard(operation.expectedVersion, version);
      }
      this.owned();
      return windowFieldReceipt(requestId, { revision, entityRef: operation.entityRef, field: operation.field }, value, undefined, operation.offsetCU ?? 0).frame;
    } catch (error) {
      const code = error instanceof WindowFrameBudgetError ? error.code
        : error instanceof WindowTextBudgetError && error.code !== "INVALID_BUDGET" ? error.code : "UNAVAILABLE";
      return windowFieldErrorReceipt(requestId, code).frame;
    }
  }
  private reportField(snapshot: Snapshot, at: TaskWindowPosition, field: TaskWindowField): string {
    const task = snapshot.source.tasks[at.taskOrder], result = task.results[at.itemOrder!];
    if (!this.report) return fail("UNAVAILABLE");
    const key = result.id;
    let report = snapshot.reports.get(key);
    if (!report) {
      report = this.report(task, result);
      this.owned();
      // Never reuse an old field version against a changed record after payload
      // eviction. Save's immutable result identity is verified, not guessed.
      const previous = snapshot.reportFingerprints.get(key);
      if (previous !== undefined && previous !== report.fingerprint) return fail("STALE");
      snapshot.reportFingerprints.set(key, report.fingerprint);
    }
    snapshot.reports.delete(key); snapshot.reports.set(key, report);
    while (snapshot.reports.size > 2) snapshot.reports.delete(snapshot.reports.keys().next().value!);
    return report.fields[field];
  }
  private frame(requestId: string, data: TaskWindowData, maxBytes = WINDOW_PAGE_MAX_JSON_BYTES): Reply {
    this.owned();
    const frame: Reply = { type: "receipt", requestId, ok: true, data };
    if (Buffer.byteLength(JSON.stringify(frame)) > maxBytes) return fail("INTERNAL_FRAME_BUDGET");
    return frame;
  }
}
