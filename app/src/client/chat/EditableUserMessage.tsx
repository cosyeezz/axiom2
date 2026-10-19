import { useEffect, useRef, useState } from "react";
import { command, useConnectionState, useScope } from "../transport.js";
import type { Scope } from "../../shared/protocol.js";
import type { EditableMessage } from "../../shared/rewrite.js";
import { agentScope, emptyAgent, running, type ChatMessage } from "../../shared/agent.js";
import { taskActive } from "../../shared/tasks.js";
import { Icon } from "../Icon.js";
import { Markdown } from "./Markdown.js";
import { MessageImages } from "./MessageImages.js";
import { useSubmission } from "./useSubmission.js";
import { messageLengthError, messageTextLimit } from "./message-limit.js";
import "../styles/message-edit.css";

function MessageEditor({ source, scope, onClose }: { source: EditableMessage; scope: Scope; onClose: () => void }) {
  const [text, setText] = useState(source.draft.text);
  const input = useRef<HTMLTextAreaElement>(null);
  const info = useScope(agentScope(scope), emptyAgent);
  const connected = useConnectionState().connected;
  const active = running(info.run) || !!info.activeTaskCount || !!info.task && taskActive(info.task.status);
  const { busy, error, submit } = useSubmission(scope, { active, nested: !!info.task, connected,
    selected: !!info.selection, runId: info.run?.id, task: info.task });
  const lengthError = messageLengthError(text);
  const hasAttachments = !!(source.draft.attachment || source.draft.attachments?.length || source.draft.images?.length);
  const disabled = busy || active || !connected || !info.selection || !!lengthError || !text.trim() && !hasAttachments;
  useEffect(() => { input.current?.focus(); input.current?.setSelectionRange(text.length, text.length); }, []);
  const send = () => {
    if (disabled) return;
    void submit("prompt", { draft: { ...source.draft, text },
      rewrite: { messageId: source.messageId, revision: source.revision }, onStart: onClose });
  };
  return <div className="message-editor" onClick={(event) => event.stopPropagation()}>
    <textarea ref={input} aria-label="修改消息" value={text} disabled={busy} rows={5}
      onChange={(event) => setText(event.target.value)} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); }
      }} />
    {hasAttachments && <div className="message-edit-attachments" aria-label="保留的附件">
      {[...(source.draft.attachment ? [source.draft.attachment] : []), ...(source.draft.attachments ?? []), ...(source.draft.images ?? [])]
        .map((attachment, index) => <span key={index}>{attachment.id ? `[${attachment.id}] ` : ""}{attachment.name}</span>)}
    </div>}
    <p className="message-edit-note">重新发送后，将忽略这条消息之后的对话。已修改的文件不会撤销。</p>
    {active && <p className="message-edit-note" role="status">请先停止此会话及活动子任务，再重新发送。</p>}
    {(error || lengthError) && <p className="execution-alert" role="alert">{lengthError || error}</p>}
    <div className="message-edit-actions"><span className="meta">{text.length.toLocaleString()} / {messageTextLimit.toLocaleString()}</span>
      <button type="button" className="btn" disabled={busy} onClick={onClose}>取消</button>
      <button type="button" className="btn primary" disabled={disabled} onClick={send}>{busy ? "正在发送…" : "重新发送"}</button>
    </div>
  </div>;
}

export function EditableUserMessage({ message, scope }: { message: ChatMessage; scope: Scope }) {
  const [source, setSource] = useState<EditableMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const editButton = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const edit = async () => {
    if (loading || source) return;
    const request = ++generation.current;
    setLoading(true); setError("");
    try {
      const result = await command<EditableMessage>("agent.editable", { messageId: message.id }, scope);
      if (request === generation.current) setSource(result);
    } catch (cause) { if (request === generation.current) setError((cause as Error).message); }
    finally { if (request === generation.current) setLoading(false); }
  };
  const close = () => {
    setSource(null);
    requestAnimationFrame(() => editButton.current?.focus({ preventScroll: true }));
  };
  return <><div className={`message-body user-text editable-user-message${source ? " is-editing" : ""}${message.images?.length ? " has-image-attachments" : ""}`}
    onClick={(event) => {
      if (source || getSelection()?.toString() || (event.target as Element).closest("button, a, input, textarea, summary, [role=button]")) return;
      void edit();
    }}>
    {source ? <MessageEditor scope={scope} source={source} onClose={close} /> : <>
      <div className="message-actions"><button ref={editButton} type="button" disabled={loading} aria-label="修改并重新发送" data-tooltip="修改并重新发送" onClick={() => void edit()}>
        <Icon name="square-pen" />
      </button></div>
      {message.text && <div className="markdown"><Markdown text={message.text} /></div>}
      <MessageImages images={message.images} scope={scope} messageId={message.id} />
      {loading && <small className="meta" role="status">正在读取原消息…</small>}
    </>}
  </div>{error && <p className="execution-alert" role="alert">{error}</p>}</>;
}
