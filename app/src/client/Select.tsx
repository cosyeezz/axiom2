import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon.js";
import { useAnchoredPopup } from "./useAnchoredPopup.js";
import "./styles/select.css";

type Option = { value: string; label: string; group?: string };

/** A select-only combobox with a viewport-bounded, modal-owned options layer. */
export function Select({ id, label, descriptionId, value, options, onChange, disabled = false, autoFocus = false, required = false, className = "input" }: {
  id?: string; label: string; descriptionId?: string; value: string; options: Option[]; onChange: (value: string) => void;
  disabled?: boolean; autoFocus?: boolean; required?: boolean; className?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null), menuId = useId();
  const [open, setOpen] = useState(false), [activeValue, setActiveValue] = useState(value);
  const search = useRef({ text: "", at: 0 });
  const expanded = open && !disabled && options.length > 0;
  const active = Math.max(0, options.findIndex(option => option.value === activeValue));
  const optionKeys = JSON.stringify(options.map(option => option.value));
  const { panel, host } = useAnchoredPopup(expanded ? trigger.current : null, { maxWidth: 640, maxHeight: 320, matchWidth: true, preferBelow: true });
  const close = () => setOpen(false);
  const show = () => { setActiveValue(value); search.current = { text: "", at: 0 }; setOpen(true); };
  const choose = (option: Option) => {
    trigger.current?.focus({ preventScroll: true });
    close();
    onChange(option.value);
  };
  useEffect(() => { if (disabled) close(); }, [disabled]);
  useLayoutEffect(() => {
    if (!expanded) return;
    const node = panel.current, option = node?.querySelectorAll<HTMLElement>('[role="option"]')[active];
    // Scroll only the options layer, never the page or the owning dialog.
    if (node && option) {
      const menuBox = node.getBoundingClientRect(), optionBox = option.getBoundingClientRect();
      if (optionBox.top < menuBox.top) node.scrollTop -= menuBox.top - optionBox.top + 4;
      else if (optionBox.bottom > menuBox.bottom) node.scrollTop += optionBox.bottom - menuBox.bottom + 4;
    }
  }, [expanded, active, optionKeys, panel]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) close();
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      const button = trigger.current;
      if (!button) return close();
      const rect = button.getBoundingClientRect(), viewport = window.visualViewport;
      let left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      let right = left + (viewport?.width ?? innerWidth), bottom = top + (viewport?.height ?? innerHeight);
      // A delayed scroll from focusing the trigger must not dismiss a newly opened menu.
      // Keep following the trigger until it leaves the viewport or a clipping ancestor.
      for (let parent = button.parentElement; parent; parent = parent.parentElement) {
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
    <button ref={trigger} type="button" id={id} className={`${className} select-trigger`} role="combobox" aria-label={label} aria-describedby={descriptionId}
      aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? menuId : undefined} aria-required={required || undefined}
      aria-activedescendant={expanded ? `${menuId}-${active}` : undefined} disabled={disabled || !options.length} autoFocus={autoFocus}
      onClick={() => expanded ? close() : show()} onBlur={close}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) { if (event.key === "Escape") event.stopPropagation(); return; }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (!expanded) show();
          const index = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
            : expanded ? (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length
            : Math.max(0, options.findIndex(option => option.value === value));
          if (options[index]) setActiveValue(options[index].value);
        } else if (expanded && ["Enter", " ", "Escape"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (event.key === "Escape") close(); else if (options[active]) choose(options[active]);
        } else if (event.key === "Tab") close();
        else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          const text = (Date.now() - search.current.at < 700 ? search.current.text : "") + event.key.toLocaleLowerCase();
          const prefix = [...text].every(character => character === text[0]) ? text[0] : text;
          const start = prefix.length === 1 ? active + 1 : active;
          const match = options.map((_, index) => options[(start + index) % options.length]).find(option => option.label.toLocaleLowerCase().startsWith(prefix));
          if (!expanded) show();
          search.current = { text, at: Date.now() };
          if (match) setActiveValue(match.value);
        }
      }}>
      <span>{options.find(option => option.value === value)?.label ?? (value || "请选择")}</span><Icon name="chevron-down" />
    </button>
    {expanded && createPortal(<div ref={panel} id={menuId} className="select-menu" popover="manual" role="listbox" aria-label={label}
      onMouseDown={event => event.preventDefault()}>
      {options.map((option, index) => <div key={option.value} role="presentation">
        {option.group && option.group !== options[index - 1]?.group && <div className="select-group" role="presentation">{option.group}</div>}
        <div id={`${menuId}-${index}`} role="option" aria-selected={value === option.value} data-value={option.value}
          className={`select-option${active === index ? " is-active" : ""}`}
          onPointerMove={event => { if (event.pointerType === "mouse") setActiveValue(option.value); }} onClick={() => choose(option)}>
          <span>{option.label}</span>{value === option.value && <Icon name="check" />}
        </div>
      </div>)}
    </div>, host)}
  </>;
}
