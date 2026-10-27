import { ForkButton } from "./ForkButton.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { command } from "../transport.js";
import type { Scope } from "../../shared/protocol.js";
import type { EditableMessage } from "../../shared/rewrite.js";
import type { ChatMessage } from "../../shared/agent.js";
import { Icon } from "../Icon.js";
import { Markdown } from "./Markdown.js";
import { SkillCards } from "./SkillCards.js";
import { MessageImages } from "./MessageImages.js";
import { beginComposerEditLoad, finishComposerEditLoad, getComposerEdit, revealComposerEdit, useComposerEdit } from "./composer-edit.js";
import { setSubmissionError } from "./submission-feedback.js";
import "../styles/message-edit.css";

export function EditableUserMessage({ message, scope, children }: { message: ChatMessage; scope: Scope; children?: ReactNode }) {
  const source = useComposerEdit(scope);
  const selected = source?.target.messageId === message.id;
  const [loading, setLoading] = useState(false);
  const setError = (error: string) => setSubmissionError(scope, error);
  const [focused, setFocused] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focused || !matchMedia("(hover: none), (pointer: coarse)").matches) return;
    const dismiss = (event: PointerEvent) => {
      const node = container.current, active = document.activeElement;
      // Safari may retain focus when tapping non-focusable content outside the message.
      if (node && !node.contains(event.target as Node) && active instanceof HTMLElement && node.contains(active)) active.blur();
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [focused]);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const edit = async () => {
    if (loading) return;
    const current = getComposerEdit(scope);
    if (current) {
      if (current.target.messageId === message.id) { revealComposerEdit(scope); setError(""); }
      else setError("请先完成或取消输入框中的修改，再修改另一条消息。");
      return;
    }
    const load = beginComposerEditLoad(scope);
    const request = ++generation.current;
    setLoading(true); setError("");
    try {
      const result = await command<EditableMessage>("agent.editable", { messageId: message.id }, scope);
      if (request === generation.current) finishComposerEditLoad(scope, load, { messageId: result.messageId, revision: result.revision }, result.draft);
    } catch (cause) { if (request === generation.current) setError((cause as Error).message); }
    finally { if (request === generation.current) setLoading(false); }
  };
  return <div ref={container} tabIndex={0} data-edit-message-id={message.id}
    onFocus={event => { if (event.currentTarget.contains(event.target)) setFocused(true); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onClick={event => {
      // Mobile Safari does not reliably focus a non-input element on tap.
      // Exclude controls and portal events so editing/preview dialogs keep their own focus.
      const target = event.target as Element, node = event.currentTarget;
      const control = target.closest("button, a, input, textarea, select, summary, [role='button'], [role='link'], [contenteditable], [tabindex]");
      if (!event.defaultPrevented && node.contains(target) && (!control || control === node) &&
          matchMedia("(hover: none), (pointer: coarse)").matches) node.focus({ preventScroll: true });
    }}
    className={`message-body user-text editable-user-message${selected ? " is-editing" : ""}${message.images?.length ? " has-image-attachments" : ""}`}>
    <div className="message-actions"><button type="button" disabled={loading} aria-label="修改并重新发送" data-tooltip="修改并重新发送" onClick={() => void edit()}>
      <Icon name="square-pen" />
    </button><ForkButton scope={scope} messageId={message.id} disabled={loading} /></div>
    {message.text && <div className="markdown"><Markdown text={message.text} attachments={[...(message.attachments ?? []), ...(message.images ?? []).map(image => ({ ...image, kind: "image" }))]} /></div>}
    <SkillCards skills={message.skills} scope={scope} />
    <MessageImages images={message.images} scope={scope} messageId={message.id} />
    {loading && <small className="meta" role="status">正在读取原消息…</small>}
    {children}
  </div>;
}
