import { createContext, memo, useContext } from "react";
import { useScope } from "../transport.js";
import type { Scope } from "../../shared/protocol.js";
import {
  emptyTasks,
  taskActive,
  taskLabels,
  tasksScope,
  type Task,
} from "../../shared/tasks.js";
export const OpenTask = createContext<(id: string) => void>(() => {});
export function TaskState({ task }: { task: Task }) {
  const state =
    task.status === "completed"
      ? "completed"
      : ["failed", "interrupted"].includes(task.status)
        ? "failed"
        : taskActive(task.status)
          ? "running"
          : "waiting";
  return (
    <span className="agent-state" data-state={state}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d={
            state === "completed"
              ? "m5 12 4 4L19 6"
              : state === "running"
                ? "M20 12a8 8 0 1 1-8-8"
                : "M12 5v9m0 4v1"
          }
        />
      </svg>
      <span className="agent-state-label">{taskLabels[task.status]}</span>
    </span>
  );
}
export const TaskCards = memo(function TaskCards({
  scope,
  anchors,
}: {
  scope: Scope;
  anchors: string[];
}) {
  const list = useScope(tasksScope(scope), emptyTasks),
    open = useContext(OpenTask);
  const tasks = list.tasks.filter((t) => anchors.includes(t.anchor));
  if (!tasks.length) return null;
  return (
    <section className="subagents" aria-label="子代理协作">
      <header className="subagents-head">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6v10a3 3 0 0 0 3 3h8M6 8h11" />
          <circle cx="6" cy="4" r="2" />
          <circle cx="19" cy="8" r="2" />
          <circle cx="19" cy="19" r="2" />
        </svg>
        <strong>子代理协作</strong>
        <span>
          {tasks.filter((t) => t.status === "completed").length} /{" "}
          {tasks.length} 已完成
        </span>
        <small>{list.frozen ? "自动处理已冻结" : "独立 pi 会话"}</small>
      </header>
      {tasks.map((t) => (
        <div className="subagent-card" key={t.id}>
          <button
            type="button"
            className="subagent"
            aria-haspopup="dialog"
            aria-label={`打开子会话：${t.description}`}
            onClick={() => open(t.id)}
          >
            <span className="agent-identity">
              <strong>{t.description}</strong>
              <small>
                {t.results.length} 次交付 ·{" "}
                {t.pending ? `${t.pending} 条待处理／核实` : "查看消息与工具"}
              </small>
            </span>
            <TaskState task={t} />
            <svg className="agent-open" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14 4h6v6m0-6-9 9M10 5H5v14h14v-5" />
            </svg>
          </button>
        </div>
      ))}
    </section>
  );
});
