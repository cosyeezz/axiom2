import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OpenCliSettings } from "../../shared/builtin-tools.js";

type WindowMode = OpenCliSettings["window"];
const options: { value: WindowMode; label: string }[] = [
  { value: "foreground", label: "前台显示" },
  { value: "background", label: "后台运行" },
];

export function BrowserWindowSelect({ value, disabled, onChange }: {
  value: WindowMode;
  disabled: boolean;
  onChange: (value: WindowMode) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0 });
  const expanded = open && !disabled;
  const show = () => { setActive(options.findIndex((option) => option.value === value)); setOpen(true); };
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  const choose = (index: number) => { onChange(options[index].value); close(); };

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!expanded) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const height = menu.current!.offsetHeight;
      const top = rect.bottom + 6 + height <= window.innerHeight - 8 ? rect.bottom + 6 : Math.max(8, rect.top - height - 6);
      setPosition({ left: rect.left, top, width: rect.width });
    };
    place();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false);
    };
    const blur = () => setOpen(false);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("blur", blur);
    document.addEventListener("pointerdown", dismiss, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("blur", blur);
      document.removeEventListener("pointerdown", dismiss, true);
    };
  }, [expanded]);

  return <>
    <button ref={trigger} type="button" id="opencli-window" className="input tools-window-select"
      role="combobox" aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? "opencli-window-options" : undefined}
      aria-activedescendant={expanded ? `opencli-window-option-${active}` : undefined}
      aria-describedby="opencli-window-help" disabled={disabled}
      onClick={() => expanded ? setOpen(false) : show()}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (!expanded) show();
          else setActive((index) => event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
        } else if (expanded && ["Enter", " ", "Escape"].includes(event.key)) {
          event.preventDefault();
          if (event.key === "Escape") close();
          else choose(active);
        } else if (event.key === "Tab") setOpen(false);
      }}>
      <span>{options.find((option) => option.value === value)?.label}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {expanded && createPortal(<div ref={menu} id="opencli-window-options" className="tools-window-menu" role="listbox" aria-label="浏览器窗口" style={position}
      onPointerDown={(event) => event.preventDefault()}>
      {options.map((option, index) => <div key={option.value} id={`opencli-window-option-${index}`} role="option"
        aria-selected={value === option.value} className={`tools-window-option${active === index ? " is-active" : ""}`}
        onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
        <span>{option.label}</span>
        {value === option.value && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>}
      </div>)}
    </div>, document.body)}
  </>;
}
