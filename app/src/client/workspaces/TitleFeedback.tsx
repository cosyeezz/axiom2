import { useEffect, useRef, useState } from "react";
import type { Scope } from "../../shared/protocol.js";
import { processingActive } from "../../shared/processing.js";
import { useProcessingList } from "../processing/records.js";
import { ProcessingDisclosure } from "../processing/ProcessDetail.js";
import { ProcessingPage } from "../pages/ProcessingPage.js";
import { MetricDetail } from "../chat/MetricDetail.js";

/** A lightweight title entry, never a conversation message or a new task card. */
export function TitleFeedback({ scope }: { scope: Scope }) {
  const read = useProcessingList(scope.workspaceId, { kind: "session.title", sessionId: scope.sessionId });
  const latest = read.data?.items[0], trigger = useRef<HTMLButtonElement>(null), previous = useRef(latest?.state);
  const [opened, setOpened] = useState(false), [history, setHistory] = useState(false);
  useEffect(() => {
    if (previous.current && processingActive(previous.current) && latest?.state === "completed") setOpened(false);
    previous.current = latest?.state;
  }, [latest?.state]);
  if (!latest && !read.error && !opened) return null;
  const active = latest && processingActive(latest.state), failed = latest && ["failed", "interrupted", "invalidated"].includes(latest.state);
  const label = read.stale ? "标题状态待确认" : active ? "标题生成中" : failed ? "标题生成失败" : "标题记录";
  return <>
    <button ref={trigger} className="title-feedback" data-state={read.stale ? undefined : latest?.state} aria-label={`标题生成记录：${label}`} aria-live="polite" aria-atomic="true" data-tooltip={label} aria-expanded={opened} aria-haspopup="dialog" onClick={() => setOpened(!opened)}>{label}</button>
    {opened && trigger.current && <MetricDetail trigger={trigger.current} title="标题生成记录" placement="auto" subtitle="当前会话 · 不影响主会话执行 · 查看不会重新生成标题" className="title-feedback-panel" onClose={() => setOpened(false)}>
      {history ? <ProcessingPage workspaceId={scope.workspaceId} initial={{ kind: "session.title", sessionId: scope.sessionId }} onBack={() => setHistory(false)} /> : <>
        {read.stale && <p className="meta" role="status">连接恢复中，暂不能确认当前标题状态。</p>}{read.error && <p role="alert">{read.error}</p>}
        {read.data?.items.slice(0, 3).map(item => <ProcessingDisclosure key={item.id} workspaceId={scope.workspaceId} item={item} />)}
        {!read.data?.items.length && !read.error && <p>没有已记录的标题生成请求。</p>}
        <button className="btn" onClick={() => setHistory(true)}>查看标题历史</button><p className="meta">手动修改标题优先；未采用的生成结果仍可在记录中查看。</p>
      </>}
    </MetricDetail>}
  </>;
}
