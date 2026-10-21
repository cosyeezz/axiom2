import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, MessagePart } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { useHistoryRevision } from "./useHistoryRevision.js";
import { detailRead } from "./detail-read.js";
import { Markdown } from "./Markdown.js";

/** Mounted only inside an open tool. Reads the hidden field once and in full; conversations are never paged. */
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
  const [full, setFull] = useState({ key, text: preview, loaded: false });
  const [status, setStatus] = useState({ key, loading: false, error: "" });
  const text = full.key === key ? full.text : preview;
  const load = useCallback(async () => {
    if (!message || pending.current) return;
    const params = { id: message.id, field: callId ? "input" : field, ...(callId ? { callId } : {}) };
    const read = detailRead<MessagePart>(key, "message.part", params, scope);
    pending.current = read;
    setStatus({ key, loading: true, error: "" });
    try {
      const result = await read.promise;
      if (current.current !== key || pending.current !== read) return;
      setFull({ key, text: result.text, loaded: true });
      setStatus({ key, loading: false, error: "" });
    } catch (cause) {
      if (current.current === key && pending.current === read) setStatus({ key, loading: false, error: (cause as Error).message });
    } finally { read.release(); if (pending.current === read) pending.current = null; }
  }, [key]);
  useEffect(() => {
    if (needed) void load();
    return () => { pending.current?.release(); pending.current = null; };
  }, [key, needed, load]);
  const error = status.key === key ? status.error : "";
  // Expose the initial read before its effect starts, so a disclosure never looks ready too early.
  const loading = status.key === key && status.loading || needed && !error && !(full.key === key && full.loaded);
  return <>
    {field === "thinking" ? <Markdown text={text || fallback} /> : <pre>{text || fallback}</pre>}
    {loading && <p className="tool-truncated" role="status">正在加载记录…</p>}
    {error && <p className="execution-alert" role="alert">{error} <button type="button" className="btn" onClick={() => void load()}>重新加载</button></p>}
  </>;
}
