import type { Run } from "../shared/agent.js";
import { taskLabels, type TaskInputState, type TaskStatus } from "../shared/tasks.js";
import type { TaskWindowCounts, TaskWindowState, WindowTaskDescriptor, WindowTaskInputDescriptor, WindowTaskResultDescriptor, WindowTaskResultRefPage } from "../shared/task-window.js";
import { WindowFrameBudgetError } from "../shared/window-frame-budget.js";
import { windowTextChunk } from "../shared/window-text-budget.js";
import type { createWindowIdentity } from "./canonical-window-identity.js";
import type { TaskWindowSource } from "./task-window-source.js";

type Identity = ReturnType<typeof createWindowIdentity>;
export type TaskWindowPosition = { kind: "task" | "result" | "input"; taskOrder: number; itemOrder: number | null };
const statuses = Object.keys(taskLabels) as TaskStatus[];
const runStatuses: Run["status"][] = ["starting", "running", "stopping", "completed", "failed", "cancelled", "interrupted"];
const inputStates: TaskInputState[] = ["queued", "unknown", "accepted", "delivered", "failed", "cancelled"];
const known = <T extends string>(value: unknown, values: readonly T[]): T | null => typeof value === "string" && values.includes(value as T) ? value as T : null;
const nonnegative = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const unavailable = (): never => { throw new WindowFrameBudgetError("UNAVAILABLE"); };
function title(value: unknown): WindowTaskDescriptor["title"] {
  if (value == null) return null;
  if (typeof value !== "string") return unavailable();
  const chunk = windowTextChunk(value, 64), result = { text: chunk.text, totalLengthCU: chunk.totalLengthCU, complete: chunk.nextOffsetCU === null };
  if (Buffer.byteLength(JSON.stringify(result)) > 128) throw new WindowFrameBudgetError("INTERNAL_FRAME_BUDGET");
  return Object.freeze(result);
}
/** Only already bounded descriptor values reach JSON.stringify here. Field
 * contents are independently versioned on demand, not encoded in this index. */
function version(identity: Identity, domain: string, values: Iterable<object>) {
  function* parts() { for (const value of values) yield JSON.stringify(value); }
  return identity.version(domain, parts());
}
function descriptor<T extends object>(identity: Identity, domain: string, data: T) {
  return Object.freeze({ ...data, descriptorVersion: version(identity, domain, [data]) });
}
function position(map: Map<string, TaskWindowPosition>, key: string, value: TaskWindowPosition) {
  const previous = map.get(key);
  if (previous && (previous.kind !== value.kind || previous.taskOrder !== value.taskOrder || previous.itemOrder !== value.itemOrder)) return unavailable();
  map.set(key, value);
}
function counts(tasks: readonly Omit<WindowTaskDescriptor, "ref">[], orders: readonly number[]): TaskWindowCounts {
  const result: TaskWindowCounts = { total: orders.length, queued: 0, starting: 0, running: 0, stopping: 0, completed: 0, failed: 0, cancelled: 0, interrupted: 0, unknown: 0 };
  for (const order of orders) result[tasks[order].status ?? "unknown"]++;
  return Object.freeze(result);
}

/** Complete host metadata once per cut, never statistics over the returned page.
 * Raw identities remain in private lookup maps. This extra O(N) index is NOT a
 * memory or CPU bound and says nothing about transcript/tail readiness. */
export function taskWindowMetadata(source: TaskWindowSource, identity: Identity) {
  const locations = new Map<string, TaskWindowPosition>(), taskReferences = new Map<string, TaskWindowPosition>(), inputReferences = new Map<string, TaskWindowPosition>();
  const anchors = new Map<string, number[]>(), taskOrders = new Map<string, number>();
  const results: Omit<WindowTaskResultDescriptor, "ref">[][] = [], inputs: Omit<WindowTaskInputDescriptor, "ref">[][] = [];
  const resultOrders: Map<string, number>[] = [];
  const tasks: Omit<WindowTaskDescriptor, "ref">[] = source.tasks.map((task, order) => {
    const taskKey = identity.key("task", task.id), anchorKey = identity.key("call", task.anchor);
    const at: TaskWindowPosition = { kind: "task", taskOrder: order, itemOrder: null };
    position(locations, taskKey, at); position(taskReferences, task.id, at);
    if (task.ref !== undefined) position(taskReferences, task.ref, at);
    if (taskOrders.has(task.id)) return unavailable();
    taskOrders.set(task.id, order);
    const group = anchors.get(anchorKey) ?? []; group.push(order); anchors.set(anchorKey, group);
    const orders = new Map<string, number>(); resultOrders.push(orders);
    const taskResults = task.results.map((result, itemOrder): Omit<WindowTaskResultDescriptor, "ref"> => {
      const resultKey = identity.key("task-result", result.id);
      position(locations, resultKey, { kind: "result", taskOrder: order, itemOrder });
      orders.set(result.id, itemOrder);
      return descriptor(identity, "task-result-descriptor-v1", { taskKey, resultKey, runKey: identity.key("run", result.runId), order: itemOrder, status: known(result.status, statuses) });
    });
    const taskInputs = task.inputs.map((input, itemOrder): Omit<WindowTaskInputDescriptor, "ref"> => {
      const inputKey = identity.key("input", input.inputId), at: TaskWindowPosition = { kind: "input", taskOrder: order, itemOrder };
      position(locations, inputKey, at); position(inputReferences, input.inputId, at);
      return descriptor(identity, "task-input-descriptor-v1", { taskKey, inputKey, runKey: input.runId === null ? null : identity.key("run", input.runId),
        order: itemOrder, state: known(input.state, inputStates), hasError: !!input.error });
    });
    results.push(taskResults); inputs.push(taskInputs);
    if (typeof task.description !== "string" || task.context != null && typeof task.context !== "string") return unavailable();
    return descriptor(identity, "task-descriptor-v1", { taskKey, anchorKey, order, title: title(task.title), status: known(task.status, statuses),
      runKey: task.runId === null ? null : identity.key("run", task.runId), initialInputKey: task.initialInputId == null ? null : identity.key("input", task.initialInputId),
      createdAt: nonnegative(task.createdAt), elapsedMs: nonnegative(task.elapsedMs), workStartedAt: nonnegative(task.workStartedAt),
      workDeadlineAt: nonnegative(task.workDeadlineAt), summaryDeadlineAt: nonnegative(task.summaryDeadlineAt), budgetRevision: nonnegative(task.budgetRevision),
      budgets: Object.freeze({ concurrency: nonnegative(task.budgets.concurrency), workMs: nonnegative(task.budgets.workMs) }), hasError: !!task.error,
      descriptionLengthCU: task.description.length, contextLengthCU: task.context == null ? null : task.context.length,
      results: Object.freeze({ total: taskResults.length, version: version(identity, "task-results-v1", taskResults) }),
      inputs: Object.freeze({ total: taskInputs.length, version: version(identity, "task-inputs-v1", taskInputs) }), lastResultKey: taskResults.at(-1)?.resultKey ?? null });
  });
  const resultRefs = source.resultRefs.map(ref => {
    const taskOrder = taskOrders.get(ref.taskId), resultOrder = taskOrder === undefined ? undefined : resultOrders[taskOrder].get(ref.resultId);
    if (taskOrder === undefined || resultOrder === undefined || source.tasks[taskOrder].results[resultOrder].runId !== ref.runId) return unavailable();
    const result = results[taskOrder][resultOrder];
    const data: Omit<WindowTaskResultRefPage["items"][number], "taskRef" | "resultRef"> = {
      taskKey: result.taskKey, resultKey: result.resultKey, runKey: result.runKey, eventVersion: ref.version, status: result.status,
    };
    return { taskOrder, resultOrder, data };
  });
  const stateData: Omit<TaskWindowState, "version"> = { frozen: source.frozen, resultVersion: source.resultVersion, readVersion: source.readVersion,
    run: source.run ? Object.freeze({ runKey: identity.key("run", source.run.id), status: known(source.run.status, runStatuses) }) : null,
    resultRefs: Object.freeze({ total: resultRefs.length, version: version(identity, "task-result-refs-v1", resultRefs.map(ref => ref.data)) }) };
  const state: TaskWindowState = Object.freeze({ ...stateData, version: version(identity, "task-state-v1", [stateData]) });
  const collection = (orders: readonly number[]) => ({ orders, counts: counts(tasks, orders), version: version(identity, "tasks-v1", orders.map(order => tasks[order])) });
  const all = collection(tasks.map((_, order) => order)), empty = collection([]);
  const groups = new Map([...anchors].map(([key, orders]) => [key, collection(orders)]));
  return { tasks, results, inputs, resultRefs, state, all, empty, groups, locations, taskReferences, inputReferences, taskOrders, resultOrders };
}
