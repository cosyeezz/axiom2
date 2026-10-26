import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon.js";
import { revealPopupOption, useAnchoredPopup } from "./useAnchoredPopup.js";
import "./styles/select.css";
import "./styles/combobox.css";

/** Suggestions never constrain or coerce the text entered by the user. */
export function ComboInput({ id, inputRef, label, value, onChange, options, optionLabel, placeholder, maxLength, className = "" }: {
  id?: string; inputRef?: RefObject<HTMLInputElement | null>;
  label: string; value: string; onChange: (value: string) => void; options: readonly string[];
  optionLabel?: (value: string) => string;
  placeholder?: string; maxLength?: number; className?: string;
}) {
  const anchor = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), menuId = useId();
  const [open, setOpen] = useState(false), [filter, setFilter] = useState(false), [active, setActive] = useState(-1);
  const choices = options.filter(option => !filter || `${option} ${optionLabel?.(option) ?? ""}`.toLowerCase().includes(value.toLowerCase()));
  const expanded = open && choices.length > 0;
  const { panel, host } = useAnchoredPopup(expanded ? anchor.current : null, { maxWidth: 640, maxHeight: 280, matchWidth: true, preferBelow: true });
  const close = () => { setOpen(false); setActive(-1); };
  const show = () => { setFilter(false); setActive(-1); setOpen(true); };
  const choose = (option: string) => { onChange(option); close(); input.current?.focus({ preventScroll: true }); };
  useLayoutEffect(() => {
    if (expanded) revealPopupOption(panel.current, active);
  }, [expanded, active, panel]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) close();
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      const node = anchor.current;
      if (!node) return close();
      const rect = node.getBoundingClientRect(), viewport = window.visualViewport;
      let left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      let right = left + (viewport?.width ?? innerWidth), bottom = top + (viewport?.height ?? innerHeight);
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if (/auto|scroll|hidden|clip/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
        if (/auto|scroll|hidden|clip/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
      }
      if (rect.right <= left || rect.left >= right || rect.bottom <= top || rect.top >= bottom) close();
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [expanded, panel]);
  return <>
    <div ref={anchor} className={`combo-input ${className}`}>
      <input id={id} ref={node => { input.current = node; if (inputRef) inputRef.current = node; }} className="input" role="combobox" aria-label={label} aria-autocomplete="list"
        aria-expanded={expanded} aria-controls={expanded ? menuId : undefined}
        aria-activedescendant={expanded && active >= 0 && choices[active] ? `${menuId}-${active}` : undefined}
        autoComplete="off" spellCheck={false} placeholder={placeholder} maxLength={maxLength} value={value}
        onBlur={close}
        onChange={event => { onChange(event.target.value); setFilter(true); setActive(-1); setOpen(true); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) { if (event.key === "Escape") event.stopPropagation(); return; }
          if (options.length && ["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            if (!expanded) { show(); setActive(event.key === "ArrowDown" ? 0 : options.length - 1); }
            else setActive(event.key === "ArrowDown" ? (active + 1) % choices.length : (active < 0 ? choices.length - 1 : (active - 1 + choices.length) % choices.length));
          } else if (expanded && event.key === "Enter") {
            event.preventDefault(); event.stopPropagation();
            if (active >= 0 && choices[active]) choose(choices[active]); else close();
          } else if (open && event.key === "Escape") {
            event.preventDefault(); event.stopPropagation(); close();
          } else if (event.key === "Tab") close();
        }} />
      {!!options.length && <button type="button" className="combo-toggle" tabIndex={-1}
        aria-label={`${label}备选项`} aria-expanded={expanded} aria-controls={expanded ? menuId : undefined}
        onMouseDown={event => event.preventDefault()}
        onClick={() => { input.current?.focus({ preventScroll: true }); if (expanded) close(); else show(); }}>
        <Icon name="chevron-down" />
      </button>}
    </div>
    {expanded && createPortal(<div ref={panel} id={menuId} className="select-menu" popover="manual" role="listbox" aria-label={`${label}备选项`}
      onMouseDown={event => event.preventDefault()}>
      {choices.map((option, index) => <div key={option} id={`${menuId}-${index}`} role="option" aria-selected={value === option} data-value={option}
        className={`select-option${active === index ? " is-active" : ""}`}
        onPointerMove={event => { if (event.pointerType === "mouse") setActive(index); }} onClick={() => choose(option)}>
        <span>{optionLabel?.(option) ?? option}</span>{value === option && <Icon name="check" />}
      </div>)}
    </div>, host)}
  </>;
}
