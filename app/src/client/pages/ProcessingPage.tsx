import { useEffect, useState } from "react";
import { command } from "../transport.js";
import { processingKinds, processingStates, type ProcessingKind, type ProcessingList, type ProcessingPayload, type ProcessingRecord, type ProcessingState } from "../../shared/processing.js";
import "../styles/processing.css";

export interface ProcessingOpening { kind?: ProcessingKind; sessionId?: string; id?: string; legacyError?: string }
const time = (value: number) => new Date(value).toLocaleString();
const duration = (start: number, end: number | null) => `${Math.max(0, ((end ?? Date.now()) - start) / 1000).toFixed(1)} 秒`;
function Payload({ label, value }: { label: string; value?: ProcessingPayload }) {
  const [copied, setCopied] = useState("");
  return <details className="processing-payload"><summary>{label}{value?.truncated ? "（记录已截断）" : ""}</summary>{value ? <><button className="btn" onClick={() => void navigator.clipboard.writeText(value.text).then(() => setCopied("已复制"), () => setCopied("复制失败，请选中文本复制"))}>复制{label}</button>{copied && <span role="status">{copied}</span>}<pre>{value.text || "（空内容）"}</pre>{value.truncated && <p>该内容超过记录上限，仅保存前 2,000,000 个字符。</p>}</> : <p>未记录</p>}</details>;
}
export function ProcessingPage({ workspaceId, initial = {}, onBack }: { workspaceId: string; initial?: ProcessingOpening; onBack?: () => void }) {
  const [kind, setKind] = useState(initial.kind ?? ""), [state, setState] = useState(""), [query, setQuery] = useState(""), [days, setDays] = useState("0");
  const [sessionId, setSessionId] = useState(initial.sessionId ?? ""), [pages, setPages] = useState<number[]>([]);
  const [list, setList] = useState<ProcessingList | null>(null), [selected, setSelected] = useState(initial.id ?? "");
  const [detail, setDetail] = useState<ProcessingRecord | null>(null), [error, setError] = useState(""), [detailError, setDetailError] = useState(""), [refresh, setRefresh] = useState(0);
  const before = pages.at(-1);
  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout>;
    setList(null); setError("");
    const load = async () => {
      try {
        const result = await command<ProcessingList>("processing.list", { kind, state, sessionId, query, before, since: Number(days) ? Date.now() - Number(days) * 86400000 : 0 }, { workspaceId });
        if (live) { setList(result); setError(""); }
      } catch (e) { if (live) setError((e as Error).message); }
      finally { if (live) timer = setTimeout(() => void load(), 4000); }
    };
    void load(); return () => { live = false; clearTimeout(timer); };
  }, [workspaceId, kind, state, sessionId, query, days, before, refresh]);
  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout>; setDetail(null); setDetailError("");
    if (!selected) return;
    const load = async () => {
      try { const result = await command<ProcessingRecord>("processing.get", { id: selected }, { workspaceId }); if (live) { setDetail(result); setDetailError(""); } }
      catch (e) { if (live) setDetailError((e as Error).message); }
      finally { if (live) timer = setTimeout(() => void load(), 4000); }
    };
    void load(); return () => { live = false; clearTimeout(timer); };
  }, [workspaceId, selected, refresh]);
  const filter = (change: () => void) => { change(); setPages([]); setSelected(""); };
  return <section className="processing-page" aria-label="处理记录" onKeyDown={(e) => { if (e.key === "Escape" && selected) { e.preventDefault(); e.stopPropagation(); setSelected(""); } }}>
    <div className="processing-heading"><div><h2>处理记录</h2><p className="meta">当前工作空间 · 自动更新 · 查看记录不会发起模型请求</p></div><div>{onBack && <button className="btn" onClick={onBack}>返回</button>}<button className="btn" onClick={() => setRefresh((n) => n + 1)}>刷新</button></div></div>
    <div className="processing-filters">
      <label>处理类型<select value={kind} onChange={(e) => filter(() => setKind(e.target.value as ProcessingKind | ""))}><option value="">全部类型</option>{Object.entries(processingKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>状态<select value={state} onChange={(e) => filter(() => setState(e.target.value))}><option value="">全部状态</option>{Object.entries(processingStates).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>时间<select value={days} onChange={(e) => filter(() => setDays(e.target.value))}><option value="0">全部时间</option><option value="1">最近一天</option><option value="7">最近七天</option><option value="30">最近三十天</option></select></label>
      <label>搜索<input placeholder="会话、文件或失败原因" value={query} onChange={(e) => filter(() => setQuery(e.target.value))} /></label>
      {sessionId && <button className="btn" onClick={() => filter(() => setSessionId(""))}>查看全部会话</button>}
    </div>
    {initial.legacyError && !initial.id && <p className="processing-legacy">来源当前错误：{initial.legacyError}。早期记录可能没有请求正文或准确失败时间。</p>}
    {error && <p role="alert">读取记录失败：{error} <button className="btn" onClick={() => setRefresh((n) => n + 1)}>重新读取</button></p>}
    <div className={`processing-layout${selected ? " has-selection" : ""}`}>
      <div className="processing-list" aria-label="处理记录列表">{!list ? !error && <p role="status">正在读取记录…</p> : !list.items.length ? <p>没有符合条件的处理记录。旧请求未记录的内容无法还原。</p> : list.items.map((item) => <button className="processing-row" key={item.id} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>
        <span><strong>{processingKinds[item.kind]}</strong><b data-state={item.state}>{processingStates[item.state]}</b></span><span>{item.title}</span><small>{time(item.startedAt)} · {duration(item.startedAt, item.endedAt)}</small><small>{item.stage}{item.legacy ? " · 历史记录" : ""}</small>{item.error && <span className="processing-row-error">{item.error}</span>}
      </button>)}<div className="processing-pagination"><button className="btn" disabled={!pages.length} onClick={() => setPages((p) => p.slice(0, -1))}>上一页</button><span>第 {pages.length + 1} 页</span><button className="btn" disabled={list?.next == null} onClick={() => { if (list?.next != null) setPages((p) => [...p, list.next!]); }}>下一页</button></div></div>
      {selected && <article className="processing-detail" aria-label="处理详情"><button className="btn" onClick={() => setSelected("")}>返回记录列表</button>{detailError ? <p role="alert">{detailError}</p> : !detail ? <p role="status">正在读取详情…</p> : <>
        <h3>{detail.title}</h3><p><strong data-state={detail.state}>{processingStates[detail.state]}</strong> · {detail.stage}</p>
        <dl><dt>开始时间</dt><dd>{time(detail.startedAt)}</dd><dt>耗时</dt><dd>{duration(detail.startedAt, detail.endedAt)}</dd><dt>来源会话</dt><dd>{detail.sessionId}</dd><dt>模型</dt><dd>{detail.selection ? `${detail.selection.provider} / ${detail.selection.id} · ${detail.selection.thinking ?? "未记录思考等级"}` : "未选择或未记录"}</dd><dt>记录编号</dt><dd>{detail.id}</dd></dl>
        {detail.legacy && <p className="processing-legacy">历史记录仅保留原有信息。缺失的请求输入、输出或阶段时间未作还原。</p>}
        {detail.error && <div className="processing-failure" role="alert"><h4>{detail.state === "cancelling" ? "取消状态说明" : "处理失败原因"}</h4><pre>{detail.error}</pre></div>}
        <details open={detail.state !== "completed"}><summary>执行过程</summary>{detail.stages.length ? <ol>{detail.stages.map((stage, i) => <li key={i}><time>{time(stage.at)}</time> {stage.name}</li>)}</ol> : <p>未记录阶段时间</p>}</details>
        <h4>模型请求 · {detail.calls.length} 次</h4>{!detail.calls.length && <p>{detail.legacy ? "未记录模型请求详情" : "未发起模型请求或未进入调用阶段"}</p>}
        {detail.calls.map((call, i) => <section className="processing-call" key={call.id}><h4>请求 {i + 1} · {call.stage}</h4><p>{call.sentAt ? `已进入模型调用 · ${time(call.sentAt)}` : call.output ? "已收到模型响应" : "未确认发出请求"} · {processingStates[call.state as ProcessingState]} · {duration(call.startedAt, call.endedAt)}</p>{call.selection && <p className="meta">{call.selection.provider} / {call.selection.id}</p>}{call.error && <pre className="processing-failure">{call.error}</pre>}<Payload label="请求输入" value={call.input} /><Payload label="模型原始响应" value={call.output} />{call.usage != null && <details><summary>用量</summary><pre>{JSON.stringify(call.usage, null, 2)}</pre></details>}</section>)}
        {detail.result && <Payload label="处理结果" value={detail.result} />}
      </>}</article>}
    </div>
  </section>;
}
