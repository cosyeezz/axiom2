import { useMemo, useState } from "react";
import { processingActive, processingFailed, processingKinds, processingOutcomes, processingStates, type ProcessingKind } from "../../shared/processing.js";
import { useProcessingList, useProcessingRecord } from "../processing/records.js";
import { ProcessingDetails, processingDuration, processingTime, useProcessingNow } from "../processing/ProcessDetail.js";
import "../styles/processing.css";

export interface ProcessingOpening { kind?: ProcessingKind; sessionId?: string; id?: string; legacyError?: string }
export function ProcessingPage({ workspaceId, initial = {}, onBack }: { workspaceId: string; initial?: ProcessingOpening; onBack?: () => void }) {
  const [kind, setKind] = useState(initial.kind ?? ""), [state, setState] = useState(""), [query, setQuery] = useState(""), [days, setDays] = useState("0");
  const [sessionId, setSessionId] = useState(initial.sessionId ?? ""), [pages, setPages] = useState<number[]>([]), [selected, setSelected] = useState(initial.id ?? "");
  const since = useMemo(() => Number(days) ? Date.now() - Number(days) * 86400000 : 0, [days]);
  const listRead = useProcessingList(workspaceId, { kind, state, sessionId, query, before: pages.at(-1), since });
  const detailRead = useProcessingRecord(workspaceId, selected || null), list = listRead.data, detail = detailRead.data;
  const now = useProcessingNow(!!list?.items.some(item => processingActive(item.state)));
  const refresh = () => { listRead.refresh(); if (selected) detailRead.refresh(); };
  const filter = (change: () => void) => { change(); setPages([]); setSelected(""); };
  return <section className="processing-page" aria-label="处理记录" onKeyDown={(e) => { if (e.key === "Escape" && selected) { e.preventDefault(); e.stopPropagation(); setSelected(""); } }}>
    <div className="processing-heading"><div><h2>处理记录</h2><p className="meta">当前工作空间 · 自动更新 · 查看记录不会发起模型请求</p></div><div>{onBack && <button className="btn" onClick={onBack}>返回</button>}<button className="btn" disabled={listRead.stale} onClick={refresh}>刷新</button></div></div>
    <div className="processing-filters">
      <label>处理类型<select value={kind} onChange={(e) => filter(() => setKind(e.target.value as ProcessingKind | ""))}><option value="">全部类型</option>{Object.entries(processingKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>状态<select value={state} onChange={(e) => filter(() => setState(e.target.value))}><option value="">全部状态</option>{Object.entries(processingStates).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>时间<select value={days} onChange={(e) => filter(() => setDays(e.target.value))}><option value="0">全部时间</option><option value="1">最近一天</option><option value="7">最近七天</option><option value="30">最近三十天</option></select></label>
      <label>搜索<input placeholder="会话、文件或失败原因" value={query} onChange={(e) => filter(() => setQuery(e.target.value))} /></label>
      {sessionId && <button className="btn" onClick={() => filter(() => setSessionId(""))}>查看全部会话</button>}
    </div>
    {initial.legacyError && !initial.id && <p className="processing-legacy">来源当前错误：{initial.legacyError}。早期记录可能没有请求正文或准确失败时间。</p>}
    {listRead.stale && <p className="meta" role="status">连接恢复中，以下为上次读取的记录；暂不能确认当前状态。</p>}
    {listRead.error && <p role="alert">读取记录失败：{listRead.error} <button className="btn" disabled={listRead.stale} onClick={refresh}>重新读取</button></p>}
    <div className={`processing-layout${selected ? " has-selection" : ""}`}>
      <div className="processing-list" aria-label="处理记录列表">{!list ? !listRead.error && <p role="status">正在读取记录…</p> : !list.items.length ? <p>没有符合条件的处理记录。旧请求未记录的内容无法还原。</p> : list.items.map((item) => <button className="processing-row" key={item.id} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>
        <span><strong>{processingKinds[item.kind]}</strong><b data-state={item.state}>{processingStates[item.state]}{item.outcome ? ` · ${processingOutcomes[item.outcome]}` : ""}</b></span><span>{item.title}</span><small>{processingTime(item.startedAt)} · {processingDuration(item.startedAt, item.endedAt, now)}</small><small>{item.stage}{item.legacy ? " · 历史记录" : ""}</small>{item.error && <span className={`processing-row-error${processingFailed(item.state) ? "" : " processing-notice"}`}>{item.error}</span>}
      </button>)}<div className="processing-pagination"><button className="btn" disabled={!pages.length} onClick={() => setPages((p) => p.slice(0, -1))}>上一页</button><span>第 {pages.length + 1} 页</span><button className="btn" disabled={list?.next == null} onClick={() => { if (list?.next != null) setPages((p) => [...p, list.next!]); }}>下一页</button></div></div>
      {selected && <article className="processing-detail" aria-label="处理详情"><button className="btn" onClick={() => setSelected("")}>返回记录列表</button>{detailRead.error && <p role="alert">{detailRead.error}</p>}{detail ? <ProcessingDetails record={detail} /> : !detailRead.error && <p role="status">正在读取详情…</p>}</article>}
    </div>
  </section>;
}
