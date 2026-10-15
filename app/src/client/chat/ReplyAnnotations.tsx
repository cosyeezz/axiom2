import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { clickedDetail, rangeOffsets, textRange } from "./annotation-ranges.js";
import type { Scope } from "../../shared/protocol.js";
import { DeleteIcon } from "../DeleteIcon.js";
import { messageTextLimit } from "./message-limit.js";
import { Markdown } from "./Markdown.js";
import {
  annotationAnchor, annotationPrompt, getAnnotations, removeAnnotation, saveAnnotation,
  updateAnnotations, useAnnotations, type ReplyAnnotation,
} from "./reply-annotations.js";
import "../styles/annotations.css";

// User-provided comment bubble, shared by the toolbar and inline annotation action.
function AnnotationIcon({ inlineHeight }: { inlineHeight?: number }) {
  // Trim the inline SVG's transparent margins so its visible outline aligns with the text.
  return <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em"
    viewBox={inlineHeight === undefined ? "0 0 24 24" : "2 3 20 18.6"}
    style={inlineHeight === undefined ? undefined : { height: inlineHeight, width: inlineHeight * 20 / 18.6 }} aria-hidden="true">
    <path d="M0 0h24v24H0z" fill="none" stroke="none" />
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path strokeWidth="1.5" d="M2.75 6.25a2.5 2.5 0 0 1 2.5-2.5h13.5a2.5 2.5 0 0 1 2.5 2.5v9a2.5 2.5 0 0 1-2.5 2.5H12.5L8 20.85a.77.77 0 0 1-1.25-.6v-2.5h-1.5a2.5 2.5 0 0 1-2.5-2.5Z" />
      <path strokeWidth="2" d="M8 10.75h.01m3.99 0h.01m3.99 0h.01" />
    </g>
  </svg>;
}
export function AnnotationToggle({ scope }: { scope?: Scope }) {
  const state = useAnnotations(scope, true);
  const label = state.enabled ? "关闭批注" : "开启批注";
  return <button type="button" className="compression-trigger annotation-toggle" aria-label={label}
    data-tooltip={`${label}${state.items.length ? ` · ${state.items.length} 条待发送` : ""}`} aria-pressed={state.enabled}
    disabled={!scope?.sessionId} onClick={() => scope && updateAnnotations(scope, { enabled: !state.enabled })}>
    <AnnotationIcon />
    {(state.items.length > 0 || !!state.editor) && <span className="annotation-count">{state.items.length || "·"}</span>}
  </button>;
}
function focusEditor(scope: Scope) {
  requestAnimationFrame(() => {
    const el = document.getElementById(`annotation-editor-${scope.workspaceId}-${scope.sessionId}`);
    el?.scrollIntoView({ block: "nearest" }); el?.focus({ preventScroll: true });
  });
}
function edit(scope: Scope, item: ReplyAnnotation, editorInTray = false) {
  // A second target must never silently replace a comment being written.
  if (!getAnnotations(scope).editor) updateAnnotations(scope, { editor: { ...item }, editorInTray });
  focusEditor(scope);
}
function AnnotationEditor({ scope, item: target, onClose }: { scope: Scope; item: ReplyAnnotation; onClose?: () => void }) {
  const current = useAnnotations(scope).editor;
  const item = current?.id === target.id ? current : target;
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { input.current?.focus({ preventScroll: true }); input.current?.scrollIntoView({ block: "nearest" }); }, []);
  const close = () => { updateAnnotations(scope, { editor: null }); onClose?.(); };
  const save = () => { saveAnnotation(scope); onClose?.(); };
  return <div className="annotation-editor" role="group" aria-label="编辑批注" onClick={(e) => e.stopPropagation()}>
    <div className="annotation-quote">{item.quote}</div>
    <textarea ref={input} id={`annotation-editor-${scope.workspaceId}-${scope.sessionId}`} aria-label="批注意见"
      placeholder="这段内容需要怎样调整？" maxLength={2000} rows={3} value={item.text}
      onChange={(e) => updateAnnotations(scope, { editor: { ...item, text: e.target.value } })}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Escape") { e.preventDefault(); close(); }
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && item.text.trim()) { e.preventDefault(); save(); }
      }} />
    <div className="annotation-editor-actions"><span>Ctrl / ⌘ + Enter 保存</span>
      <button type="button" className="btn btn-ghost" onClick={close}>取消</button>
      <button type="button" className="btn" disabled={!item.text.trim()} onClick={save}>保存批注</button>
    </div>
  </div>;
}
export function AnnotatedReply({ scope, messageId, text, streaming }: {
  scope: Scope; messageId: string; text: string; streaming?: boolean;
}) {
  const owner = useMemo(() => ({ workspaceId: scope.workspaceId, sessionId: scope.sessionId }), [scope.workspaceId, scope.sessionId]);
  const images = useMemo(() => ({ scope: owner, messageId }), [owner, messageId]);
  const renderBlock = useCallback((children: ReactNode, block: number, source: string) => (
    <AnnotationBlock key={block} scope={owner} messageId={messageId} block={block} source={source} eligible={!streaming}>
      {children}
    </AnnotationBlock>
  ), [owner, messageId, streaming]);
  return <Markdown text={text} images={images} renderBlock={renderBlock} />;
}
const markedRanges = new Map<HTMLElement, Range[]>();
function paintAnnotations() {
  if (typeof Highlight !== "undefined") CSS.highlights.set("reply-annotation", new Highlight(...[...markedRanges.values()].flat()));
}
function previewRange(range?: Range | null) {
  if (typeof Highlight !== "undefined") {
    if (range) CSS.highlights.set("reply-annotation-hover", new Highlight(range));
    else CSS.highlights.delete("reply-annotation-hover");
  }
}
function noteRange(root: HTMLElement, item: ReplyAnnotation) {
  if (item.start !== undefined && item.end !== undefined) return textRange(root, item.start, item.end);
  const start = (root.textContent ?? "").indexOf(item.quote);
  return textRange(root, start, start + item.quote.length);
}
function AnnotationPopover({ scope, item, root, onClose }: {
  scope: Scope; item: ReplyAnnotation; root: HTMLElement; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, ready: false });
  useEffect(() => {
    const place = () => {
      const rect = (noteRange(root, item)?.getBoundingClientRect()) ?? root.getBoundingClientRect();
      const height = panel.current?.offsetHeight ?? 260, width = panel.current?.offsetWidth ?? 400;
      const below = rect.bottom + 8;
      const top = Math.max(12, Math.min(innerHeight - height - 12, below + height <= innerHeight - 12 ? below : rect.top - height - 8));
      const left = Math.max(12, Math.min(innerWidth - width - 12, rect.left));
      setPosition((old) => old.top === top && old.left === left && old.ready ? old : { top, left, ready: true });
    };
    place();
    const observer = new ResizeObserver(place); if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [root, item.id, item.start, item.end]);
  useEffect(() => { if (position.ready) panel.current?.querySelector("textarea")?.focus({ preventScroll: true }); }, [position.ready]);
  return createPortal(<div ref={panel} className="annotation-popover" role="dialog" aria-label="内容批注"
    style={{ top: position.top, left: position.left, visibility: position.ready ? "visible" : "hidden" }}
    onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape" && !e.nativeEvent.isComposing) { e.preventDefault(); updateAnnotations(scope, { editor: null }); onClose(); } }}>
    <AnnotationEditor scope={scope} item={item} onClose={onClose} />
  </div>, root.closest("dialog") ?? document.body);
}
function AnnotationBlock({ scope, messageId, block, source, children, eligible }: {
  scope: Scope; messageId: string; block: number; source: string; children: ReactNode; eligible: boolean;
}) {
  const state = useAnnotations(scope, true), body = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const enabled = state.enabled && eligible;
  const candidate = useRef<Range | null>(null);
  const [error, setError] = useState("");
  const [marker, setMarker] = useState<{ top: number; left: number; iconHeight: number } | null>(null);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const notes = useMemo(() => state.items.filter((item) => item.messageId === messageId && item.block === block && item.source === source),
    [state.items, messageId, block, source]);
  const editor = !state.editorInTray && state.editor?.messageId === messageId && state.editor.block === block && state.editor.source === source ? state.editor : null;
  useEffect(() => {
    if (!enabled) return;
    const root = body.current!;
    const mark = () => {
      const current = getAnnotations(scope);
      const items = current.items.filter((item) => item.messageId === messageId && item.block === block && item.source === source);
      if (current.editor?.messageId === messageId && current.editor.block === block && current.editor.source === source) items.push(current.editor);
      const ranges = items.map((item) => noteRange(root, item)).filter((range): range is Range => !!range);
      markedRanges.set(root, ranges); paintAnnotations();
      const top = root.getBoundingClientRect().top;
      setPositions(Object.fromEntries(items.map((item) => [item.id, Math.max(0, (noteRange(root, item)?.getBoundingClientRect().top ?? top) - top)])));
    };
    mark(); const observer = new ResizeObserver(mark); observer.observe(root);
    return () => { observer.disconnect(); markedRanges.delete(root); paintAnnotations(); };
  }, [enabled, state.items, state.editor, source, messageId, block, scope.workspaceId, scope.sessionId]);
  const placeTrigger = useCallback(() => {
    const root = body.current;
    if (!root) return;
    const range = candidate.current ?? clickedDetail(root, root);
    if (!range) { setMarker(null); return; }
    const leaf = range.endContainer.parentElement?.closest("p,li,th,td,h1,h2,h3,h4,h5,h6");
    const tail = range.cloneRange();
    // Follow the last character of prose, including inline formatting. Code
    // keeps the current line as its target instead of the entire code block.
    if (leaf && root.contains(leaf)) {
      const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT);
      let node: Node | null, last: Node | null = null;
      while ((node = walker.nextNode())) if (node.textContent?.trim()) last = node;
      if (last) tail.setEnd(last, last.textContent!.trimEnd().length);
    }
    if (tail.endContainer.nodeType === Node.TEXT_NODE && tail.endOffset > 0)
      tail.setStart(tail.endContainer, tail.endOffset - 1);
    else tail.collapse(false);
    const rect = tail.getBoundingClientRect(), bounds = root.parentElement!.getBoundingClientRect();
    if (!rect.height) { setMarker(null); return; }
    // The markers are positioned against the shell, which can start above the
    // source (e.g. heading margins). Keep the visible bubble within this text row.
    const next = { top: rect.top - bounds.top, left: Math.max(0, rect.right - bounds.left + 4), iconHeight: rect.height / 2 };
    setMarker((previous) => previous?.top === next.top && previous.left === next.left && previous.iconHeight === next.iconHeight ? previous : next);
  }, []);
  useEffect(() => {
    if (!enabled) { previewRange(); setError(""); candidate.current = null; return; }
    const root = body.current!;
    placeTrigger();
    const observer = new ResizeObserver(placeTrigger); observer.observe(root);
    root.addEventListener("scroll", placeTrigger, true);
    return () => { observer.disconnect(); root.removeEventListener("scroll", placeTrigger, true); };
  }, [enabled, placeTrigger]);
  useEffect(() => () => {
    previewRange();
    const current = getAnnotations(scope);
    if (current.editor?.messageId === messageId && current.editor.block === block && current.editor.source === source)
      updateAnnotations(scope, { editorInTray: true });
  }, [scope.workspaceId, scope.sessionId, messageId, block, source]);
  const detail = (target: HTMLElement, x?: number, y?: number) => clickedDetail(body.current!, target, x, y);
  const open = (range: Range | null) => {
    const root = body.current!, selection = getSelection();
    if (selection && !selection.isCollapsed) {
      if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {
        setError("选区跨越了不同段落或回复，请缩小选区后再批注。"); previewRange(); return;
      }
      range = selection.getRangeAt(0).cloneRange();
    }
    if (!range || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
    const quote = range.toString();
    if (!quote.trim()) return;
    if (quote.length > 6000) { setError("引用过长，请选中 6,000 字以内的文字后添加批注。"); return; }
    const [start, end] = rangeOffsets(root, range);
    setError(""); previewRange();
    edit(scope, { id: crypto.randomUUID(), messageId, block, source, quote, start, end, text: "" });
  };
  return <div className={`annotation-shell${enabled ? " annotation-block" : ""}`} id={annotationAnchor(scope, messageId, block)}
    onMouseLeave={() => { if (enabled && !getSelection()?.toString()) previewRange(); }}>
    <div ref={body} className="annotation-source" onMouseMove={(e) => {
      if (!enabled || e.buttons || state.editor || (e.target as HTMLElement).closest("a,button,input,textarea,summary,[role=button]")) return;
      const range = detail(e.target as HTMLElement, e.clientX, e.clientY);
      candidate.current = range; previewRange(range);
      placeTrigger();
    }} onMouseUp={(e) => {
      if (!enabled) return;
      const selection = getSelection(), root = body.current!;
      if (selection && !selection.isCollapsed && (root.contains(selection.anchorNode) || root.contains(selection.focusNode)) &&
        !(e.target as HTMLElement).closest("a,button,input,textarea")) open(selection.getRangeAt(0).cloneRange());
    }} onClick={(e) => {
      if (!enabled || (e.target as HTMLElement).closest("a,button,input,textarea,summary,[role=button]")) return;
      open(detail(e.target as HTMLElement, e.clientX, e.clientY));
    }}>
      {children}
    </div>
    {enabled && <div className="annotation-markers">
      {notes.filter((item, i) => !notes.slice(0, i).some((previous) => Math.abs((positions[previous.id] ?? 0) - (positions[item.id] ?? 0)) < 28)).map((item) => <button key={item.id} type="button" className="annotation-marker" style={{ top: positions[item.id] ?? 0 }}
        aria-label={`编辑批注 ${state.items.indexOf(item) + 1}`} data-tooltip={item.text} data-annotation-id={item.id}
        onClick={() => edit(scope, item)}>{state.items.indexOf(item) + 1}</button>)}
      <button ref={trigger} type="button" className="annotation-add" style={marker ? { top: marker.top, left: marker.left } : { display: "none" }} aria-label="批注选中文字或这一句"
        data-tooltip="选中文字可精确批注；直接点击正文批注当前句、列表项或代码行"
        onMouseDown={(e) => e.preventDefault()} onClick={() => open(candidate.current ?? detail(body.current!))}>
        <AnnotationIcon inlineHeight={marker?.iconHeight} />
      </button>
    </div>}
    {enabled && error && <p className="annotation-error" role="alert">{error}</p>}
    {enabled && editor && body.current && <AnnotationPopover scope={scope} item={editor} root={body.current} onClose={() => trigger.current?.focus({ preventScroll: true })} />}
  </div>;
}
export function AnnotationTray({ scope, disabled, send }: {
  scope: Scope; disabled: boolean; send: (items: ReplyAnnotation[], text: string) => void;
}) {
  const state = useAnnotations(scope, true), id = useId();
  if (!state.enabled) return null;
  const prompt = annotationPrompt(state.items), tooLong = prompt.length > messageTextLimit;
  // The tray also edits saved quotes whose source has left the visible context.
  return <section className="annotation-tray" aria-label="回复批注">
    <div className="annotation-tray-bar">
      <span>{state.items.length ? `待发送批注 ${state.items.length} 条` : "点击具体句子或选中几个字，添加批注"}</span>
      {!!state.items.length && <><button type="button" className="btn btn-ghost" aria-expanded={state.expanded} aria-controls={id}
        onClick={() => updateAnnotations(scope, { expanded: !state.expanded })}>{state.expanded ? "收起" : "查看全部"}</button>
        <button type="button" className="btn" disabled={disabled || !!state.editor || tooLong}
          data-tooltip={state.editor ? "请先保存或取消正在编辑的批注" : "统一发送原文与批注意见"}
          onClick={() => send(state.items, prompt)}>发送批注</button></>}
    </div>
    {tooLong && <p className="annotation-error" role="alert">原文与批注合计超过 12,000 字，请缩短引用或减少本轮批注后发送。</p>}
    {state.editorInTray && state.editor && <AnnotationEditor scope={scope} item={state.editor} />}
    {state.expanded && <ol id={id} className="annotation-list">{state.items.map((item, i) => <li key={item.id}>
      <div className="annotation-list-text"><button type="button" className="annotation-locate" data-tooltip="定位原文" onClick={() => {
        const target = document.getElementById(annotationAnchor(scope, item.messageId, item.block));
        if (target) {
          const root = target.querySelector<HTMLElement>(".annotation-source"), scroller = target.closest(".thread");
          const range = root && noteRange(root, item);
          if (range && scroller) scroller.scrollBy({ top: range.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientHeight / 2 });
          else target.scrollIntoView({ block: "center" });
          const marker = [...target.querySelectorAll<HTMLButtonElement>(".annotation-marker")].find((node) => node.dataset.annotationId === item.id);
          marker?.focus({ preventScroll: true });
        }
      }}>{i + 1}. {item.quote}</button><p>{item.text}</p></div>
      <button type="button" className="btn btn-ghost" aria-label={`修改批注 ${i + 1}`} onClick={() => edit(scope, item, true)}>编辑</button>
      <button type="button" className="icon-btn" aria-label={`删除批注 ${i + 1}`} onClick={() => removeAnnotation(scope, item.id)}><DeleteIcon /></button>
    </li>)}</ol>}
  </section>;
}
