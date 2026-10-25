import { useEffect, useState } from "react";
import { processingActive, processingFailed, processingReasonLabels, processingOutcomes, processingStates, type ProcessingPayload, type ProcessingRecord, type ProcessingSummary } from "../../shared/processing.js";
import { useProcessingRecord } from "./records.js";
import "../styles/processing.css";

export const processingTime = (value: number) => new Date(value).toLocaleString();
export const processingDuration = (start: number, end: number | null, now = Date.now()) => `${Math.max(0, ((end ?? now) - start) / 1000).toFixed(1)} 秒`;
/** Only the elapsed label ticks. No polling or model command is tied to the clock. */
export function useProcessingNow(active: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
function Payload({ label, value }: { label: string; value?: ProcessingPayload }) {
  const [copied, setCopied] = useState("");
  return <details className="processing-payload"><summary>{label}{value?.truncated ? "（记录已截断）" : ""}</summary>{value ? <><button className="btn" onClick={() => void navigator.clipboard.writeText(value.text).then(() => setCopied("已复制"), () => setCopied("复制失败，请选中文本复制"))}>复制{label}</button>{copied && <span role="status">{copied}</span>}<pre>{value.text || "（空内容）"}</pre>{value.truncated && <p>该内容超过记录上限，仅保存前 2,000,000 个字符。</p>}</> : <p>未记录</p>}</details>;
}
export function ProcessingSummaryLine({ item }: { item: ProcessingSummary }) {
  const now = useProcessingNow(processingActive(item.state));
  return <span className="processing-summary-line"><strong data-state={item.state}>{processingStates[item.state]}</strong><span>{item.stage}</span><small>{processingDuration(item.startedAt, item.endedAt, now)}</small>{item.outcome && <span>{processingOutcomes[item.outcome]}</span>}</span>;
}
/** The same authorized record body is used by all business entry points. */
export function ProcessingDetails({ record }: { record: ProcessingRecord }) {
  const now = useProcessingNow(processingActive(record.state));
  return <>
    <h3>{record.title}</h3><ProcessingSummaryLine item={record} />
    <dl><dt>开始时间</dt><dd>{processingTime(record.startedAt)}</dd><dt>耗时</dt><dd>{processingDuration(record.startedAt, record.endedAt, now)}</dd><dt>来源会话</dt><dd>{record.sessionId}</dd><dt>模型</dt><dd>{record.selection ? `${record.selection.provider} / ${record.selection.id} · ${record.selection.thinking ?? "未记录思考等级"}` : "未选择或未记录"}</dd><dt>记录编号</dt><dd>{record.id}</dd>{record.runId && <><dt>原执行编号</dt><dd>{record.runId}</dd></>}{record.toolCallId && <><dt>原工具调用</dt><dd>{record.toolCallId}</dd></>}</dl>
    {record.batch && <details className="processing-batch"><summary>本批次范围 · {record.batch.purposeIds.length} 个目的 · {record.batch.sessionIds.length} 个来源会话 · {record.batch.published ? "已原子发布" : "未发布"}</summary><p>目录更新{record.batch.published ? "已应用" : "尚未应用"}{record.batch.skipped ? `；跳过 ${record.batch.skipped} 个目的` : ""}。</p><dl><dt>目的编号</dt><dd>{record.batch.purposeIds.join("、") || "无"}</dd><dt>来源会话</dt><dd>{record.batch.sessionIds.join("、") || "无"}</dd></dl></details>}
    {record.legacy && <p className="processing-legacy">历史记录仅保留原有信息。缺失的请求输入、输出或阶段时间未作还原。</p>}
    {record.error && <div className={processingFailed(record.state) ? "processing-failure" : "processing-notice"} role={processingFailed(record.state) ? "alert" : "status"}><h4>{processingReasonLabels[record.state]}</h4><pre>{record.error}</pre></div>}
    <details open={record.state !== "completed"}><summary>执行过程</summary>{record.stages.length ? <ol>{record.stages.map((stage, i) => <li key={i}><time>{processingTime(stage.at)}</time> {stage.name}</li>)}</ol> : <p>未记录阶段时间</p>}</details>
    <h4>模型请求 · {record.calls.length} 次</h4>{!record.calls.length && <p>{record.legacy ? "未记录模型请求详情" : "未发起模型请求或未进入调用阶段"}</p>}
    {record.calls.map((call, i) => <section className="processing-call" key={call.id}><h4>请求 {i + 1} · {call.stage}</h4><p>{call.sentAt ? `已进入模型调用 · ${processingTime(call.sentAt)}` : call.output ? "已收到模型响应" : "未确认发出请求"} · {processingStates[call.state]} · {processingDuration(call.startedAt, call.endedAt, now)}</p>{call.sentAt && <p className="meta">此时间仅表示进入调用，不代表供应商已确认或已计费。</p>}{call.selection && <p className="meta">{call.selection.provider} / {call.selection.id}</p>}{call.error && <pre className={processingFailed(call.state) ? "processing-failure" : "processing-notice"}>{call.error}</pre>}<Payload label="请求输入" value={call.input} /><Payload label="模型原始响应" value={call.output} />{call.usage != null && <details><summary>用量 · 诊断信息，不作为重复计费依据</summary><pre>{JSON.stringify(call.usage, null, 2)}</pre></details>}</section>)}
    {record.result && <Payload label="处理结果" value={record.result} />}
  </>;
}
export function ProcessingRecordDetail({ workspaceId, id }: { workspaceId: string; id: string }) {
  const read = useProcessingRecord(workspaceId, id);
  return <div className="processing-detail">{read.stale && <p className="meta" role="status">连接恢复中，以下为上次读取的记录；暂不能确认当前状态。</p>}{read.error && <p role="alert">{read.error} <button className="btn" disabled={read.stale} onClick={read.refresh}>重新读取</button></p>}{read.data ? <ProcessingDetails record={read.data} /> : !read.error && <p role="status">正在读取详情…</p>}</div>;
}
export function ProcessingDisclosure({ workspaceId, item }: { workspaceId: string; item: ProcessingSummary }) {
  const [expanded, setExpanded] = useState(false);
  return <details className="processing-disclosure" onToggle={event => setExpanded(event.currentTarget.open)}><summary><span>{item.title}</span><ProcessingSummaryLine item={item} /></summary>{item.error && <p className={processingFailed(item.state) ? "processing-failure" : "processing-notice"}>{item.error}</p>}{expanded && <ProcessingRecordDetail workspaceId={workspaceId} id={item.id} />}</details>;
}
