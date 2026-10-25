import { useEffect, useRef, useState } from "react";
import type { ChatMessage, MessagePart } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import type { TaskTool } from "../../shared/tasks.js";
import { taskExecutionText } from "../tasks/task-call.js";
import { useHistoryRevision } from "./useHistoryRevision.js";
import { detailRead } from "./detail-read.js";
import { JsonPaths } from "../LocalPath.js";
import { Markdown } from "./Markdown.js";

/** Mounted inside an open disclosure. Reads hidden fields in full and refreshes them while streaming. */
export function MessagePartBody({ scope, message, callId, field = "text", fallback = "尚未记录输出", taskTool }: {
  scope: Scope; message: ChatMessage | null; callId?: string; field?: "text" | "thinking"; fallback?: string; taskTool?: TaskTool | null;
}) {
  const history = useHistoryRevision(scope);
  const call = message?.calls?.find((value) => value.id === callId);
  const preview = callId ? call?.input ?? "" : field === "thinking" ? message?.thinking ?? "" : message?.text || message?.error || "";
  const length = callId ? call?.inputLength : field === "thinking" ? message?.thinkingLength : message?.textLength;
  const needed = length !== undefined ? length > preview.length : !!message?.truncated;
  const fieldRevision = callId ? call?.inputRevision : field === "thinking" ? message?.thinkingRevision : message?.textRevision;
  const identity = JSON.stringify([scope.workspaceId, scope.sessionId, message?.id, field, callId, history]);
  const key = JSON.stringify(["part", scope.workspaceId, scope.sessionId, message?.id, field, callId, fieldRevision ?? message?.detailsRevision, preview, history]);
  const current = useRef(identity); current.current = identity;
  const pending = useRef<{ release(): void } | null>(null);
  const [full, setFull] = useState<{ identity: string; key: string; text: string } | null>(null);
  const [failed, setFailed] = useState<{ identity: string; key: string; error: string } | null>(null);
  // Keep compatible full text visible while newer deltas are read in the background.
  // A complete preview or a rewritten prefix must replace it immediately.
  const retained = full?.identity === identity && (full.key === key || needed && full.text.startsWith(preview) && (length === undefined || full.text.length <= length));
  const text = retained ? full.text : preview;
  useEffect(() => () => {
    pending.current?.release(); pending.current = null;
  }, [identity]);
  useEffect(() => {
    if (!message || !needed || pending.current || full?.identity === identity && full.key === key || failed?.identity === identity && failed.key === key) return;
    const params = { id: message.id, field: callId ? "input" : field, ...(callId ? { callId } : {}) };
    const read = detailRead<MessagePart>(key, "message.part", params, scope);
    pending.current = read;
    const finish = () => {
      read.release();
      if (pending.current !== read) return false;
      pending.current = null;
      return current.current === identity;
    };
    // Revision changes leave this read alive. Settling it triggers one read of the latest key.
    void read.promise.then(result => {
      if (!finish()) return;
      setFull({ identity, key, text: result.text });
      setFailed(null);
    }, cause => {
      if (finish()) setFailed({ identity, key, error: (cause as Error).message });
    });
  }, [identity, key, needed, full, failed]);
  const error = needed && failed?.identity === identity ? failed.error : "";
  // Expose the initial read before its effect starts; background refreshes keep the body steady.
  const loading = needed && !error && !retained;
  const visibleText = taskTool ? taskExecutionText(taskTool, message ? { ...message, text, truncated: needed && !retained } : null) : text;
  return <>
    {field === "thinking" ? <Markdown text={text || fallback} pathScope={scope} /> : <><pre>{visibleText || fallback}</pre>{callId && <JsonPaths text={text} scope={scope} />}</>}
    {loading && <p className="tool-truncated" role="status">正在加载记录…</p>}
    {error && <p className="execution-alert" role="alert">{error} <button type="button" className="btn" onClick={() => setFailed(null)}>重新加载</button></p>}
  </>;
}
