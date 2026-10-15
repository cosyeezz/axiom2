import { useEffect, useState } from "react";
import type { Scope } from "../../shared/protocol.js";
import type { TaskResult } from "../../shared/tasks.js";
import { command } from "../transport.js";
import { Markdown } from "../chat/Markdown.js";

/** Continues the selected immutable result, never switches to the latest run. */
export function TaskReportBody({ scope, report }: { scope: Scope; report: TaskResult }) {
  const [page, setPage] = useState(report);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setPage(report); setError(""); }, [report.id, report.offset, report.report]);
  return <>
    {page.reportKind && <p className="task-call-meta">{page.reportKind === "final" ? "最终回复" : page.reportKind === "partial" ? "部分成果" : "系统执行记录"}</p>}
    <div className="markdown"><Markdown text={page.report} /></div>
    {page.truncated && page.nextOffset != null && <button type="button" className="btn" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try {
        const next = await command<TaskResult>("task.result", { taskId: page.taskId, resultId: page.id, offset: page.nextOffset }, scope);
        setPage((current) => current.id === next.id && current.nextOffset === next.offset
          ? { ...next, offset: current.offset, report: current.report + next.report } : current);
      } catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    }}>{busy ? "读取中…" : "继续读取"} · {page.nextOffset}/{page.totalLength} 字符</button>}
    {error && <p className="task-call-error" role="alert">{error}</p>}
  </>;
}
