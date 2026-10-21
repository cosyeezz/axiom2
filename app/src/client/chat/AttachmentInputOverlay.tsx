import { useLayoutEffect, useRef, useState, type RefObject, type ReactNode } from "react";
import type { Draft } from "../../shared/protocol.js";
import { AttachmentSymbol } from "./AttachmentSymbol.js";

/** A visual mirror keeps the native textarea's selection, IME, undo and clipboard behavior. */
export function AttachmentInputOverlay({ input, draft }: { input: RefObject<HTMLTextAreaElement | null>; draft: Draft }) {
  const mirror = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const references = new Map<string, { kind?: string }>([
    ...(draft.attachments ?? []).filter((a) => a.id).map((a) => [a.id!, a] as const),
    ...(draft.images ?? []).map((a) => [a.id, { ...a, kind: "image" }] as const),
  ]);
  const parts: ReactNode[] = [];
  let end = 0, count = 0;
  for (const match of draft.text.matchAll(/\[(file\d+|folder\d+|(?:img|imag)\d+)\]/g)) {
    const item = references.get(match[1]);
    if (!item) continue;
    const start = match.index, finish = start + match[0].length;
    // Only reveal the reference being edited; IME in surrounding prose must not flicker every chip.
    const editing = selection && (selection.start === selection.end
      ? selection.start > start && selection.start < finish
      : selection.start < finish && selection.end > start);
    parts.push(draft.text.slice(end, start));
    parts.push(editing ? match[0] : <span className="attachment-inline-reference" key={start}>
      <span className="attachment-reference-source">{match[0]}</span>
      <span className="attachment-reference-icon"><AttachmentSymbol kind={item.kind} id={match[1]} label={item.kind === "image" ? match[1] : undefined} /></span>
    </span>);
    count++; end = finish;
  }
  parts.push(draft.text.slice(end), "\u200b");
  const enabled = count > 0;
  useLayoutEffect(() => {
    const node = input.current, layer = mirror.current;
    if (!node || !layer) return;
    const sync = () => {
      const style = getComputedStyle(node);
      Object.assign(layer.style, {
        left: `${node.offsetLeft}px`, top: `${node.offsetTop}px`, width: `${node.clientWidth}px`, height: `${node.clientHeight}px`,
        fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
        fontStyle: style.fontStyle, lineHeight: style.lineHeight, fontFeatureSettings: style.fontFeatureSettings,
        fontVariant: style.fontVariant, fontKerning: style.fontKerning,
        letterSpacing: style.letterSpacing, padding: style.padding,
        textIndent: style.textIndent, tabSize: style.tabSize, wordSpacing: style.wordSpacing,
        whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap, wordBreak: style.wordBreak,
        textAlign: style.textAlign, direction: style.direction,
      });
      // A native token can wrap across lines. Keep that local fragment readable rather
      // than placing a single badge over unrelated text on either line.
      for (const reference of layer.querySelectorAll<HTMLElement>(".attachment-inline-reference")) {
        const source = reference.querySelector<HTMLElement>(".attachment-reference-source")!;
        const icon = reference.querySelector<HTMLElement>(".attachment-reference-icon")!;
        const fragments = source.getClientRects();
        reference.toggleAttribute("data-wrapped", fragments.length > 1);
        if (fragments.length === 1 && icon.offsetWidth) {
          icon.style.setProperty("--reference-scale", String(Math.min(1, fragments[0].width / icon.offsetWidth)));
        }
      }
      // Keep the mirror aligned through textarea auto-growth and native scrolling.
      layer.scrollTop = node.scrollTop; layer.scrollLeft = node.scrollLeft;
    };
    const select = () => setSelection((previous) => {
      const next = document.activeElement === node ? { start: node.selectionStart, end: node.selectionEnd } : null;
      return previous?.start === next?.start && previous?.end === next?.end ? previous : next;
    });
    node.classList.toggle("has-attachment-overlay", enabled);
    sync(); select();
    const observer = new ResizeObserver(sync); observer.observe(node);
    node.addEventListener("scroll", sync); node.addEventListener("select", select);
    node.addEventListener("keyup", select); node.addEventListener("click", select);
    node.addEventListener("focus", select); node.addEventListener("blur", select);
    node.addEventListener("input", select);
    node.addEventListener("compositionstart", select); node.addEventListener("compositionend", select);
    return () => {
      observer.disconnect(); node.classList.remove("has-attachment-overlay");
      node.removeEventListener("scroll", sync); node.removeEventListener("select", select);
      node.removeEventListener("keyup", select); node.removeEventListener("click", select);
      node.removeEventListener("focus", select); node.removeEventListener("blur", select);
      node.removeEventListener("input", select);
      node.removeEventListener("compositionstart", select); node.removeEventListener("compositionend", select);
    };
  }, [input, draft.text, enabled, selection?.start, selection?.end]);
  return <div ref={mirror} className="attachment-input-overlay" aria-hidden="true" hidden={!enabled}>{parts}</div>;
}
