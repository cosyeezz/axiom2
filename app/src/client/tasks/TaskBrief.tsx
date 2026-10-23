import { useLayoutEffect, useState } from "react";
import type { Task } from "../../shared/tasks.js";

/** The durable brief also remains available after its initial turn is compacted. */
export function TaskBrief({ task, reveal = 0 }: { task: Task; reveal?: number }) {
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => { if (reveal) setExpanded(true); }, [reveal]);
  const sections = [
    ...(task.context != null ? [["任务背景", task.context]] : []),
    ["任务目标", task.description],
  ];
  const long = sections.some(([, text]) => text.length > 360 || text.split("\n").length > 6);
  return <article className="task-brief" data-task-brief tabIndex={-1} aria-label="任务说明" data-collapsed={long && !expanded}>
    {sections.map(([label, text]) => <section key={label}>
      <h3>{label}</h3>
      <p>{text}</p>
    </section>)}
    {long && <button type="button" className="task-brief-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {expanded ? "收起任务说明" : "展开任务说明"}
    </button>}
  </article>;
}
