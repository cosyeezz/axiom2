import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon.js";
import { useAnchoredPopup } from "../useAnchoredPopup.js";

type Option = { value: string; label: string };

/** Memory filters keep their menu inside the owning side panel and above its clipping area. */
export function MemoryFilter({ label, value, options, onChange }: {
  label: string; value: string; options: Option[]; onChange: (value: string) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState(value);
  const search = useRef({ text: "", at: 0 });
  const id = useId();
  const expanded = open && options.length > 0;
  const active = Math.max(0, options.findIndex((option) => option.value === activeValue));
  const optionKeys = JSON.stringify(options.map((option) => option.value));
  const { panel, host } = useAnchoredPopup(expanded ? trigger.current : null, { maxWidth: 520, maxHeight: 320, matchWidth: true, preferBelow: true });
  const show = () => { setActiveValue(value); search.current = { text: "", at: 0 }; setOpen(true); };
  const close = () => { setOpen(false); };
  const choose = (option: Option) => {
    // Restore focus before a workspace change can replace this filter instance.
    trigger.current?.focus({ preventScroll: true });
    close();
    onChange(option.value);
  };

  useLayoutEffect(() => {
    if (expanded) panel.current?.querySelectorAll<HTMLElement>('[role="option"]')[active]?.scrollIntoView({ block: "nearest" });
  }, [expanded, active, optionKeys, panel]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) close();
    };
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) close(); };
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
    <button ref={trigger} type="button" className="memory-filter-trigger" role="combobox" aria-label={label}
      aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? id : undefined}
      aria-activedescendant={expanded ? `${id}-${active}` : undefined} disabled={!options.length}
      onClick={() => expanded ? close() : show()} onBlur={close}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) {
          if (event.key === "Escape") event.stopPropagation();
          return;
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (!expanded) show();
          const index = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
            : expanded ? (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length
            : Math.max(0, options.findIndex((option) => option.value === value));
          if (options[index]) setActiveValue(options[index].value);
        } else if (expanded && ["Enter", " ", "Escape"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (event.key === "Escape") close();
          else if (options[active]) choose(options[active]);
        } else if (event.key === "Tab") close();
        else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          const previous = Date.now() - search.current.at < 700 ? search.current.text : "";
          const text = previous + event.key.toLocaleLowerCase();
          const prefix = [...text].every((character) => character === text[0]) ? text[0] : text;
          const start = prefix.length === 1 ? active + 1 : active;
          const match = options.map((_, index) => options[(start + index) % options.length])
            .find((option) => option.label.toLocaleLowerCase().startsWith(prefix));
          if (!expanded) show();
          search.current = { text, at: Date.now() };
          if (match) setActiveValue(match.value);
        }
      }}>
      <span>{options.find((option) => option.value === value)?.label ?? label}</span><Icon name="chevron-down" />
    </button>
    {expanded && createPortal(<div ref={panel} id={id} className="memory-filter-menu" popover="manual" role="listbox" aria-label={label}
      onMouseDown={(event) => event.preventDefault()}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={value === option.value}
        className={`memory-filter-option${active === index ? " is-active" : ""}`}
        onPointerMove={(event) => { if (event.pointerType === "mouse") setActiveValue(option.value); }} onClick={() => choose(option)}>
        <span>{option.label}</span>{value === option.value && <Icon name="check" />}
      </div>)}
    </div>, host)}
  </>;
}
