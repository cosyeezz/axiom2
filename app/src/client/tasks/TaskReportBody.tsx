import { useEffect, useState } from "react";
import type { Scope } from "../../shared/protocol.js";
import type { TaskResult } from "../../shared/tasks.js";
import { command } from "../transport.js";
import { Markdown } from "../chat/Markdown.js";

/** Shows the selected immutable result in full, never switches to the latest run. Sessions are never paged. */
export function TaskReportBody({ scope, report }: { scope: Scope; report: TaskResult }) {
  const [page, setPage] = useState(report);
  const [error, setError] = useState("");
  useEffect(() => { setPage(report); setError(""); }, [report.id, report.offset, report.report]);
  const missing = page.truncated && page.nextOffset != null && !error;
  useEffect(() => {
    if (!missing) return;
    let current = true;
    const offset = page.nextOffset!;
    command<TaskResult>("task.result", { taskId: page.taskId, resultId: page.id, offset }, scope).then((next) => {
      if (current) setPage((old) => old.id === next.id && old.nextOffset === next.offset
        ? { ...next, offset: old.offset, report: old.report + next.report } : old);
    }, (cause) => { if (current) setError((cause as Error).message); });
    return () => { current = false; };
  }, [missing, page.id, page.nextOffset]);
  return <>
    {page.reportKind && <p className="task-call-meta">{page.reportKind === "final" ? "最终回复" : page.reportKind === "partial" ? "部分成果" : "系统执行记录"}</p>}
    <div className="markdown"><Markdown text={page.report} /></div>
    {missing && <p className="task-call-meta" role="status">正在读取完整结果…</p>}
    {error && <div className="task-call-error" role="alert">{error}<button type="button" className="btn" onClick={() => setError("")}>重新加载</button></div>}
  </>;
}
