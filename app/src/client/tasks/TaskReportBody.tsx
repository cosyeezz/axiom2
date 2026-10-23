import type { Scope } from "../../shared/protocol.js";
import type { TaskResult } from "../../shared/tasks.js";
import { Markdown } from "../chat/Markdown.js";

/** Shows the selected immutable result in full, never switches to the latest run. */
export function TaskReportBody({ scope, report }: { scope: Scope; report: TaskResult }) {
  return <>
    {report.reportKind && <p className="task-call-meta">{report.reportKind === "final" ? "最终回复" : report.reportKind === "partial" ? "部分成果" : "系统执行记录"}</p>}
    <div className="markdown"><Markdown text={report.report} pathScope={scope} /></div>
  </>;
}
