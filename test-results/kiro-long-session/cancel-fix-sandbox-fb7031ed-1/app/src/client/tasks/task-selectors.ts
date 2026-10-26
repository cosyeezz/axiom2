import { useCallback, useMemo, useSyncExternalStore } from "react";
import { emptyTasks, tasksScope, type Task, type TaskList } from "../../shared/tasks.js";
import type { Scope } from "../../shared/protocol.js";
import { scopeSnapshot, subscribeScope } from "../transport.js";
const empty: Task[] = [];
const indexes = new WeakMap<TaskList, { byAnchor: Map<string, Task[]>; byId: Map<string, Task> }>();
export function taskIndex(list: TaskList) {
  let index = indexes.get(list);
  if (!index) {
    index = { byAnchor: new Map(), byId: new Map() };
    for (const task of list.tasks) {
      index.byId.set(task.id, task);
      if (task.ref) index.byId.set(task.ref, task);
      const group = index.byAnchor.get(task.anchor) ?? [];
      group.push(task); index.byAnchor.set(task.anchor, group);
    }
    indexes.set(list, index);
  }
  return index;
}
export function tasksAt(list: TaskList, anchor: string) { return taskIndex(list).byAnchor.get(anchor) ?? empty; }
function useTaskSelection<T>(scope: Scope, key: string, select: (list: TaskList, key: string) => T) {
  const name = tasksScope(scope);
  const subscribe = useCallback((fn: () => void) => subscribeScope(name, fn), [name]);
  const snapshot = useMemo(() => {
    let previous: TaskList | undefined, value: T;
    return () => {
      const list = scopeSnapshot<TaskList>(name) ?? emptyTasks;
      if (list !== previous) {
        const next = select(list, key);
        if (!previous || JSON.stringify(next) !== JSON.stringify(value)) value = next;
        previous = list;
      }
      return value;
    };
  }, [name, key, select]);
  return useSyncExternalStore(subscribe, snapshot);
}
const taskAt = (list: TaskList, id: string) => taskIndex(list).byId.get(id);
export function useAnchorTasks(scope: Scope, anchor: string) { return useTaskSelection(scope, anchor, tasksAt); }
export function useTask(scope: Scope, id: string) { return useTaskSelection(scope, id, taskAt); }
