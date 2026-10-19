import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { command } from "../transport.js";
import { updateDraft } from "../drafts.js";
import type { Scope } from "../../shared/protocol.js";
import { FileCompletionPopup } from "./FileCompletionPopup.js";
import { atFileToken, insertFileSuggestion, type FileSuggestions, type FileSuggestion } from "./file-completion.js";

export function useFileCompletion(scope: Scope, text: string, input: RefObject<HTMLTextAreaElement | null>) {
  const id = useId(), [cursor, setCursor] = useState(0), [focused, setFocused] = useState(false),
    [composing, setComposing] = useState(false), [dismissed, setDismissed] = useState(""),
    [result, setResult] = useState<FileSuggestions | null>(null), [loading, setLoading] = useState(false),
    [error, setError] = useState(""), [index, setIndex] = useState(0);
  const generation = useRef(0), query = `${text}\0${cursor}`;
  const open = focused && !composing && dismissed !== query && atFileToken(text, cursor);
  useEffect(() => {
    const request = ++generation.current;
    setResult(null); setError(""); setIndex(0);
    if (!open) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      void command<FileSuggestions | null>("files.complete", { text, cursor }, scope).then((next) => {
        if (generation.current === request) { setResult(next); setLoading(false); }
      }, (e: Error) => {
        if (generation.current === request) { setError(e.message); setLoading(false); }
      });
    }, 120);
    return () => { clearTimeout(timer); generation.current++; };
  }, [text, cursor, open, scope.workspaceId, scope.sessionId]);
  useEffect(() => {
    document.getElementById(`${id}-${index}`)?.scrollIntoView({ block: "nearest" });
  }, [id, index]);
  function choose(item: FileSuggestion) {
    if (!result || loading || input.current?.value !== text || input.current.selectionStart !== cursor) return;
    const next = insertFileSuggestion(text, cursor, result.prefix, item);
    if (!next || next.text.length > 12000) return;
    updateDraft(scope, { text: next.text });
    setCursor(next.cursor); setResult(null);
    if (!item.label.endsWith("/")) setDismissed(`${next.text}\0${next.cursor}`);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(next.cursor, next.cursor); });
  }
  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open || e.nativeEvent.isComposing || e.keyCode === 229) return false;
    if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation(); setDismissed(query); return true;
    }
    const items = result?.items ?? [];
    if (["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      if (items.length) setIndex((old) => (old + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
      return true;
    }
    if ((e.key === "Enter" && !e.shiftKey) || (e.key === "Tab" && !e.shiftKey && items.length)) {
      e.preventDefault();
      if (items[index]) choose(items[index]);
      return true; // Never send the prompt while the picker is open/loading/empty.
    }
    return false;
  }
  return {
    keyDown,
    bindings: {
      onInput: () => { setDismissed(""); setCursor(input.current?.selectionStart ?? 0); },
      onSelect: () => setCursor(input.current?.selectionStart ?? 0),
      onFocus: () => { setFocused(true); setCursor(input.current?.selectionStart ?? 0); },
      onBlur: () => setFocused(false),
      onCompositionStart: () => setComposing(true),
      onCompositionEnd: () => { setComposing(false); setCursor(input.current?.selectionStart ?? 0); },
      "aria-autocomplete": "list" as const,
      "aria-controls": open ? id : undefined,
      "aria-expanded": open,
      "aria-activedescendant": open && result?.items[index] ? `${id}-${index}` : undefined,
    },
    popup: open ? <FileCompletionPopup input={input}>
      <div className="file-picker-heading"><strong>引用文件 · pi</strong><span>↑↓ 选择 · Enter / Tab 插入 · Esc 关闭</span></div>
      <div id={id} role="listbox" aria-label="pi 文件选择" aria-busy={loading}>
        {result?.items.map((item, i) => <button type="button" role="option" id={`${id}-${i}`} key={item.value}
          aria-selected={i === index} data-tooltip={item.value} onPointerDown={(e) => e.preventDefault()} onClick={() => choose(item)}>
          <span>{item.label}</span>{item.description && <small>{item.description}</small>}
        </button>)}
      </div>
      {(loading || error || !result?.items.length) && <p role="status">{loading ? "正在搜索工作空间文件…" : error || "没有匹配文件，继续输入路径或按 Esc 返回编辑"}</p>}
    </FileCompletionPopup> : null,
  };
}
