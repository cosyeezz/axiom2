import type { Run } from "./agent.js";
import type { Scope } from "./protocol.js";
import type { TaskInputState, TaskStatus } from "./tasks.js";
import type { WindowCallDescriptor, WindowFieldInfo } from "./thread-window.js";
import type { WindowFieldData } from "./window-frame-budget.js";

export const TASK_WINDOW_MEMBERSHIP_ITEMS = 32;
/** Raw identities already present in the rendered ThreadIndex, not action refs. */
export interface TaskResultMembershipRef { readonly taskId: string; readonly resultId: string }

/** Independent host task cut, NOT the worker transcript revision. No partial
 * page has the deletion semantics of the legacy tasks subscription. */
export type TaskWindowQuery =
  | { op: "open"; anchorKey?: string }
  | { op: "tasks"; revision: string; anchorKey?: string; anchor?: string; before?: number; expectedVersion?: string }
  | { op: "target"; revision: string; taskRef: string }
  | { op: "results"; revision: string; taskRef: string; before?: number; expectedVersion?: string }
  | { op: "inputs"; revision: string; taskRef: string; before?: number; expectedVersion?: string }
  | { op: "resultRefs"; revision: string; before?: number; expectedVersion?: string }
  | { op: "hasResults"; revision: string; references: readonly TaskResultMembershipRef[] }
  | { op: "locate"; revision: string; key: string }
  | { op: "lookup"; revision: string; kind: "task" | "input"; reference: string }
  | { op: "fieldInfo"; revision: string; entityRef: string; field: TaskWindowField }
  | { op: "field"; revision: string; entityRef: string; field: TaskWindowField; offsetCU?: number; expectedVersion?: string };
/** Task: text=instructions, input=background, error=display error, metadata={title,modelRef}.
 * Input receipts expose error only. Selected immutable results: text=report,
 * input=display notes (side effects + unfinished), error=reason, metadata=small
 * status/kind/time record. Each field is independently versioned and chunked. */
export type TaskWindowField = "text" | "input" | "error" | "metadata";
export type TaskWindowCounts = Record<TaskStatus | "unknown", number> & { total: number };
export interface TaskWindowCollection {
  total: number;
  /** Whole ordered metadata, not just the loaded page or unpreviewed fields. */
  version: string;
}
export interface WindowTaskDescriptor {
  ref: string;
  taskKey: string;
  anchorKey: string;
  /** Absolute task order in the parent scope, even in an anchor-filtered page. */
  order: number;
  descriptorVersion: string;
  title: WindowCallDescriptor["name"] | null;
  status: TaskStatus | null;
  runKey: string | null;
  initialInputKey: string | null;
  createdAt: number | null;
  elapsedMs: number | null;
  workStartedAt: number | null;
  workDeadlineAt: number | null;
  summaryDeadlineAt: number | null;
  budgetRevision: number | null;
  budgets: { concurrency: number | null; workMs: number | null };
  hasError: boolean;
  descriptionLengthCU: number;
  contextLengthCU: number | null;
  results: TaskWindowCollection;
  inputs: TaskWindowCollection;
  lastResultKey: string | null;
}
export interface WindowTaskResultDescriptor {
  ref: string;
  taskKey: string;
  resultKey: string;
  runKey: string;
  order: number;
  status: TaskStatus | null;
  descriptorVersion: string;
}
export interface WindowTaskInputDescriptor {
  ref: string;
  taskKey: string;
  inputKey: string;
  runKey: string | null;
  order: number;
  state: TaskInputState | null;
  hasError: boolean;
  descriptorVersion: string;
}
interface TaskPage<T> extends TaskWindowCollection {
  revision: string;
  previous: number | null;
  next: number | null;
  items: T[];
}
export interface TaskWindowState {
  version: string;
  frozen: boolean;
  run: { runKey: string; status: Run["status"] | null } | null;
  resultVersion: number;
  readVersion: number;
  resultRefs: TaskWindowCollection;
}
export interface WindowTaskPage extends TaskPage<WindowTaskDescriptor> {
  kind: "tasks";
  identityNamespace: string;
  anchorKey: string | null;
  /** Counts over the WHOLE selected collection, never the returned 64 items. */
  counts: TaskWindowCounts;
  state: TaskWindowState;
}
export interface WindowTaskResultPage extends TaskPage<WindowTaskResultDescriptor> { kind: "results"; taskRef: string }
export interface WindowTaskInputPage extends TaskPage<WindowTaskInputDescriptor> { kind: "inputs"; taskRef: string }
export interface WindowTaskResultRefPage extends TaskPage<{
  taskRef: string;
  resultRef: string;
  taskKey: string;
  resultKey: string;
  runKey: string;
  eventVersion: number;
  status: TaskStatus | null;
}> {
  kind: "resultRefs";
  state: TaskWindowState;
}
export interface WindowTaskLocation {
  kind: "location";
  revision: string;
  /** Null proves absence only in this task cut, not deletion or global readiness. */
  location: null | { kind: "task" | "result" | "input"; ref: string; taskRef: string; taskOrder: number; itemOrder: number | null };
}
/** Explicit current-owner navigation bridge for legacy OpenTask consumers.
 * Display keys/ordinals themselves never authorize an action. */
export interface WindowTaskTarget { kind: "target"; revision: string; taskRef: string; taskId: string; sessionId: string; initialInputId: string | null }
export type WindowTaskDestination = Pick<WindowTaskTarget, "taskId" | "sessionId" | "initialInputId">;
/** Membership of every supplied pair in one complete task cut. Not a rendered
 * transcript witness, navigation authority or permission to acknowledge a tail. */
export interface WindowTaskMembership { kind: "membership"; revision: string; matched: boolean }
export type TaskWindowData = WindowTaskMembership | WindowTaskTarget | WindowTaskPage | WindowTaskResultPage | WindowTaskInputPage | WindowTaskResultRefPage | WindowTaskLocation | WindowFieldInfo | WindowFieldData;
export const taskWindowScope = (scope: Scope) => `task-window:${scope.workspaceId}:${scope.sessionId}`;
