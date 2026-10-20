import { useEffect, useRef, useState } from "react";
import { memoryOrganizationScope, type MemoryOrganization } from "../../shared/memory.js";
import type { Scope } from "../../shared/protocol.js";
import { command, useScope } from "../transport.js";
import { BubbleLoadingIcon } from "../StatusIcons.js";
import { publicMemoryError } from "./memory-errors.js";

export function MemoryOrganizeControl({ scope, disabled = false, disabledReason, label = "立即整理" }: {
  scope: Pick<Scope, "workspaceId"> & Partial<Pick<Scope, "sessionId">>;
  disabled?: boolean; disabledReason?: string; label?: string;
}) {
  const job = useScope<MemoryOrganization | null>(memoryOrganizationScope(scope.workspaceId), null);
  const [submitting, setSubmitting] = useState(false), [error, setError] = useState("");
  const mounted = useRef(true), pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const running = job?.status === "running";
  const relevant = job && (!scope.sessionId || !job.sessionId || job.sessionId === scope.sessionId);
  const act = async (cancel = false) => {
    if (pending.current || !cancel && (disabled || running)) return;
    pending.current = true; setSubmitting(true); setError("");
    try { await command(cancel ? "memory.organize.cancel" : "memory.organize", cancel ? { id: job!.id } : {}, scope); }
    catch (failure) { if (mounted.current) setError(publicMemoryError((failure as Error).message)); }
    finally { pending.current = false; if (mounted.current) setSubmitting(false); }
  };
  const notice = !relevant ? "" : running ? `正在整理 ${job.processed} / ${job.total}`
    : job.status === "completed" ? job.succeeded ? `整理完成：已生成 ${job.succeeded} 条摘要${job.skipped ? `，跳过 ${job.skipped} 个无需整理的来源` : ""}` : "暂无需要整理的内容"
    : job.status === "partial" ? `已生成 ${job.succeeded} 条摘要，${job.failed} 个来源未完成`
    : job.status === "cancelled" ? "整理已取消" : job.status === "interrupted" ? "整理已中断，请重新整理" : "整理失败，请重试";
  const failure = error || (relevant && ["failed", "partial", "interrupted"].includes(job.status) && job.error ? publicMemoryError(job.error) : "");
  return <div className="memory-organize">
    <button type="button" className="btn" disabled={disabled || submitting || running} aria-busy={submitting || running}
      data-tooltip={disabledReason || (scope.sessionId ? "根据已保存的本会话记忆生成摘要，会产生模型用量" : "整理此工作空间全部待整理来源，会产生模型用量")}
      onClick={() => void act()}>{(submitting || running) && <BubbleLoadingIcon />}{running ? "整理中…" : submitting ? "正在提交…" : label}</button>
    {running && relevant && <button type="button" className="btn" disabled={submitting} onClick={() => void act(true)}>取消整理</button>}
    {notice && <p className="memory-organization-status" role="status">{notice}</p>}
    {failure && <p className="memory-organization-status memory-error" role="alert">{failure}</p>}
  </div>;
}
