import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, MessagePart } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { useHistoryRevision } from "./useHistoryRevision.js";
import { detailRead, forgetDetailReads } from "./detail-read.js";
import { Markdown } from "./Markdown.js";

/** Mounted only inside an open tool. Appends pages without replacing the scroll container. */
export function MessagePartBody({ scope, message, callId, field = "text", fallback = "尚未记录输出" }: {
  scope: Scope; message: ChatMessage | null; callId?: string; field?: "text" | "thinking"; fallback?: string;
}) {
  const history = useHistoryRevision(scope);
  const call = message?.calls?.find((value) => value.id === callId);
  const preview = callId ? call?.input ?? "" : field === "thinking" ? message?.thinking ?? "" : message?.text || message?.error || "";
  const length = callId ? call?.inputLength : field === "thinking" ? message?.thinkingLength : message?.textLength;
  const needed = length !== undefined ? length > preview.length : !!message?.truncated;
  const fieldRevision = callId ? call?.inputRevision : field === "thinking" ? message?.thinkingRevision : message?.textRevision;
  const key = JSON.stringify(["part", scope.workspaceId, scope.sessionId, message?.id, field, callId, fieldRevision ?? message?.detailsRevision, preview, history]);
  const current = useRef(key); current.current = key;
  const pending = useRef<{ release(): void } | null>(null);
  const [page, setPage] = useState<{ key: string; text: string; nextOffset: number | null; revision?: string; totalLength?: number }>({ key, text: preview, nextOffset: null });
  const [status, setStatus] = useState({ key, loading: false, error: "" });
  const visible = page.key === key ? page : { key, text: preview, nextOffset: null };
  const load = useCallback(async (offset = 0, revision?: string) => {
    if (!message || pending.current) return;
    const params = { id: message.id, field: callId ? "input" : field, ...(callId ? { callId } : {}), offset, ...(revision ? { revision } : {}) };
    const read = detailRead<MessagePart>(`${key}:${offset}:${revision ?? ""}`, "message.part", params, scope);
    pending.current = read;
    setStatus({ key, loading: true, error: "" });
    try {
      const result = await read.promise;
      if (current.current !== key || pending.current !== read) return;
      if (result.offset !== offset || result.nextOffset !== null && result.nextOffset <= offset) throw Error("分页响应无效，请重新读取");
      setPage((old) => ({ key, text: offset && old.key === key ? old.text + result.text : result.text,
        nextOffset: result.nextOffset, revision: result.revision, totalLength: result.totalLength }));
      setStatus({ key, loading: false, error: "" });
    } catch (cause) {
      if (current.current === key && pending.current === read) {
        // A changed record cannot be appended to a previous revision. Retry starts from page one.
        if ((cause as { code?: string }).code === "REVISION_CONFLICT") {
          forgetDetailReads(`${key}:`);
          setPage({ key, text: preview, nextOffset: null });
        }
        setStatus({ key, loading: false, error: (cause as Error).message });
      }
    } finally { read.release(); if (pending.current === read) pending.current = null; }
  }, [key]);
  useEffect(() => {
    if (needed) void load();
    return () => { pending.current?.release(); pending.current = null; };
  }, [key, needed, load]);
  const loading = status.key === key && status.loading, error = status.key === key ? status.error : "";
  return <>
    {field === "thinking" ? <Markdown text={visible.text || fallback} /> : <pre>{visible.text || fallback}</pre>}
    {loading && <p className="tool-truncated" role="status">正在加载记录…</p>}
    {error && <p className="execution-alert" role="alert">{error} <button type="button" className="btn" onClick={() => void load(visible.nextOffset ?? 0, visible.nextOffset ? visible.revision : undefined)}>重新加载</button></p>}
    {visible.nextOffset !== null && !error && <button type="button" className="btn" disabled={loading} onClick={() => void load(visible.nextOffset!, visible.revision)}>
      {loading ? "正在加载…" : "继续加载"}（{visible.text.length.toLocaleString()} / {visible.totalLength?.toLocaleString()} 字符）
    </button>}
  </>;
}
