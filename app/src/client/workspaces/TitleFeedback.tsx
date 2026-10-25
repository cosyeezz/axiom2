import { useEffect, useRef, useState } from "react";
import type { Scope } from "../../shared/protocol.js";
import { processingActive, processingFailed, processingStates, type ProcessingList, type ProcessingSummary } from "../../shared/processing.js";
import { titleProcessCandidate, titleCardResult } from "../../shared/title-card.js";
import { command } from "../transport.js";
import { useProcessingList, useProcessingRecord } from "../processing/records.js";
import { Payload, processingDuration, processingTime, useProcessingNow } from "../processing/ProcessDetail.js";
import { ProcessTitle } from "../chat/ProcessStatus.js";
import { Dialog, Icon } from "../components.js";
import { useModelDisplay } from "../useModelDisplay.js";
import "../styles/title-result.css";

/** Read summaries only, including older pages hidden behind empty-memory checks. */
export function useTitleProcesses(scope: Scope | null) {
  const list = useProcessingList(scope?.workspaceId ?? null, { kind: "session.title", sessionId: scope?.sessionId });
  const key = `${scope?.workspaceId}:${scope?.sessionId}`;
  const [scan, setScan] = useState<{ key: string; items: ProcessingSummary[] }>();
  useEffect(() => {
    if (!scope || !list.data || list.stale || list.error) return;
    let cancelled = false;
    const root = list.data, captured = scope;
    void (async () => {
      const items = [...root.items];
      let before = root.next;
      while (before !== null && !cancelled) {
        const page = await command<ProcessingList>("processing.list", { kind: "session.title", sessionId: captured.sessionId, before }, { workspaceId: captured.workspaceId });
        if (cancelled) return;
        items.push(...page.items);
        if (page.next !== null && page.next >= before) throw Error("标题记录分页未推进");
        before = page.next;
      }
      if (!cancelled) setScan({ key, items });
    })().catch(() => { /* Keep known summaries; the shared list owns read errors. */ });
    return () => { cancelled = true; };
  }, [key, list.data, list.stale, list.error]);
  // Keep older cards mounted during refresh; fresh summaries always supersede them.
  const items = new Map<string, ProcessingSummary>();
  if (!list.error && list.data) for (const item of [...(scan?.key === key ? scan.items : []), ...list.data.items]) {
    if (item.workspaceId === scope?.workspaceId && item.sessionId === scope?.sessionId) items.set(item.id, item);
  }
  return { items: [...items.values()].filter(titleProcessCandidate).sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id)), stale: list.stale };
}

/** Summary-only metadata. Merely displaying a card must never read request bodies. */
export function TitleProcessCard({ item, stale = false }: { item: ProcessingSummary; stale?: boolean }) {
  const [opened, setOpened] = useState(false), trigger = useRef<HTMLButtonElement>(null);
  const display = useModelDisplay(), model = display(item.selection ?? {});
  const active = processingActive(item.state) && !stale;
  const status = `${stale ? "连接恢复后同步状态" : processingStates[item.state]}${item.outcome === "not_applied" ? " · 未采用" : ""}`;
  const close = () => { setOpened(false); if (!trigger.current?.isConnected) document.querySelector<HTMLElement>("#thread")?.focus({ preventScroll: true }); };
  return <article className="title-result-card" data-processing-id={item.id} data-state={item.state} aria-label="标题生成">
    <button ref={trigger} type="button" className="title-result-trigger" aria-haspopup="dialog" aria-expanded={opened}
      aria-label={`查看标题生成详情：${status}`} title={`标题生成 · ${status}，点击查看详情`} onClick={() => setOpened(true)}>
      <span className="title-result-icon"><Icon name="heading" /></span>
      <span className="title-result-copy"><strong><ProcessTitle label="标题生成" active={active} /></strong>
        <small title={model.label}>{model.label}</small></span>
      <Icon name="subagent-open" className="title-result-open" />
    </button>
    {opened && <TitleProcessDialog item={item} stale={stale} onClose={close} />}
  </article>;
}

/** Mount the detail subscription and elapsed clock only after an explicit open. */
function TitleProcessDialog({ item, stale, onClose }: { item: ProcessingSummary; stale: boolean; onClose: () => void }) {
  const read = useProcessingRecord(item.workspaceId, item.id);
  const record = read.data?.id === item.id && read.data.sessionId === item.sessionId && read.data.workspaceId === item.workspaceId ? read.data : undefined;
  const result = record && titleCardResult(record), display = useModelDisplay();
  const active = processingActive(item.state) && !stale;
  const now = useProcessingNow(active), model = display(item.selection ?? {});
  const failed = processingFailed(item.state);
  const label = processingActive(item.state) ? (item.state === "cancelling" ? "正在取消标题生成" : "正在生成标题")
    : failed ? "标题生成失败" : item.state === "completed" ? (result?.title ?? "标题生成已结束") : `标题生成 · ${processingStates[item.state]}`;
  return <Dialog title="标题生成详情" onClose={onClose} className="title-process-dialog">
      <button type="button" autoFocus className="title-dialog-close" aria-label="关闭标题生成详情" onClick={onClose}><Icon name="close" /></button>
      <div className="title-dialog-summary"><span className="title-dialog-heading"><Icon name="heading" /><ProcessTitle label={label} active={active} /></span>
        <p>{model.label} · {processingDuration(item.startedAt, item.endedAt, now)}{item.outcome === "not_applied" && " · 未采用，当前会话名称保持不变"}</p></div>
      <div className="title-dialog-body">
      {(stale || read.stale) && <p className="title-dialog-notice" role="status">正在同步连接，以下为上次读取的记录；暂不能确认当前状态。</p>}
      {read.error && <p className="title-dialog-error" role="alert">详情读取失败：{read.error} <button type="button" className="btn" onClick={read.refresh}>重新读取</button></p>}
      {(record?.error || item.error) && <div className={failed ? "title-dialog-error" : "title-dialog-notice"} role={failed ? "alert" : "status"}><strong>{failed ? "标题生成失败，原标题保持不变" : "本次处理说明"}</strong><pre>{record?.error ?? item.error}</pre></div>}
      {!record && !read.error && <p role="status">正在读取真实调用记录…</p>}
      {record && <div className="title-dialog-layout"><section className="title-dialog-stages"><h3>生成过程</h3>
        {record.stages.length ? <ol>{record.stages.map((stage, index) => <li key={`${index}:${stage.at}`} data-current={index === record.stages.length - 1 || undefined}><span>{stage.name}</span><time>{new Date(stage.at).toLocaleTimeString()}</time></li>)}</ol> : <p className="meta">未记录阶段时间，未作还原。</p>}
        <p className="meta">{processingTime(record.startedAt)}</p></section>
        <section className="title-dialog-calls"><h3>模型调用 <span>{record.calls.length} 次</span></h3>
          {!record.calls.length && <p className="meta">尚未进入模型调用，或此历史记录未保存调用详情。</p>}
          {record.calls.map((call, index) => <section className="title-dialog-call" key={call.id}>
            <h4>调用 {index + 1}<span>{processingStates[call.state]}</span></h4><p className="meta">{call.stage} · {processingDuration(call.startedAt, call.endedAt, now)}</p>
            <p className="meta">{call.sentAt ? `进入调用：${processingTime(call.sentAt)}` : "未确认发出请求"}；不代表供应商已确认或已计费。</p>
            {call.error && <pre className="title-dialog-error">{call.error}</pre>}
            <Payload label="输入内容" value={call.input} open /><Payload label="输出内容" value={call.output} open />
          </section>)}
          {result && <div className="title-dialog-result"><span>{result.applied ? "生成标题" : "生成标题 · 未采用"}</span><strong>{result.title}</strong></div>}
          {record.result && !result && <Payload label="处理结果" value={record.result} />}
          <details className="title-dialog-diagnostics"><summary>记录信息</summary><dl><dt>记录编号</dt><dd>{record.id}</dd><dt>所属执行</dt><dd>{record.runId ?? "未记录"}</dd><dt>位置依据</dt><dd>{record.anchorMessageId ? "生成触发时的消息" : record.runId ? "所属对话轮次（历史记录未保存精确触发消息）" : "未记录"}</dd></dl></details>
        </section></div>}
      </div>
    </Dialog>;
}
