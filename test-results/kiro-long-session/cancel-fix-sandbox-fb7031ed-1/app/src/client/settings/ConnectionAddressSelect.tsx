import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon.js";
import { revealPopupOption, useAnchoredPopup } from "../useAnchoredPopup.js";

const family = (address: string) => address.includes("[") ? "IPv6" : "IPv4";

export function ConnectionAddressSelect({ value, options, onChange }: {
  value: string; options: string[]; onChange: (address: string) => void;
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false), [activeAddress, setActiveAddress] = useState(value);
  const active = Math.max(0, options.indexOf(activeAddress));
  const setActive = (index: number) => setActiveAddress(options[index] ?? value);
  const { panel, host } = useAnchoredPopup(open ? trigger.current?.parentElement ?? null : null, { maxWidth: 440, maxHeight: 300, matchWidth: true, preferBelow: true });
  useLayoutEffect(() => {
    const button = trigger.current;
    return () => {
      if (button && document.activeElement === button) button.closest(".phone-connect-details")?.querySelector<HTMLButtonElement>(".phone-connect-actions button")?.focus({ preventScroll: true });
    };
  }, []);
  const show = () => { trigger.current?.focus({ preventScroll: true }); setActive(Math.max(0, options.indexOf(value))); setOpen(true); };
  const choose = (index: number) => {
    if (options[index]) onChange(options[index]);
    setOpen(false); trigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (open) revealPopupOption(panel.current, active);
  }, [open, active, options, panel]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", close);
    return () => { document.removeEventListener("pointerdown", outside, true); window.removeEventListener("blur", close); };
  }, [open, panel]);
  return <>
    <button ref={trigger} type="button" className="phone-address-trigger" role="combobox" aria-label="选择连接地址"
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
      aria-activedescendant={open ? `${id}-${active}` : undefined}
      onClick={() => open ? setOpen(false) : show()} onBlur={() => setOpen(false)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const index = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
            : open ? (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length
            : Math.max(0, options.indexOf(value));
          setActive(index); setOpen(true);
        } else if (open && ["Enter", " ", "Escape"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (event.key === "Escape") setOpen(false); else choose(active);
        } else if (event.key === "Tab") setOpen(false);
      }}>
      <span>{family(value)}</span><Icon name="chevron-down" />
    </button>
    {open && createPortal(<div ref={panel} id={id} className="phone-address-menu" popover="manual" role="listbox" aria-label="连接地址"
      onPointerDown={event => event.preventDefault()}>
      {options.map((address, index) => <div key={address} id={`${id}-${index}`} role="option" aria-selected={value === address}
        className="phone-address-option" data-active={active === index}
        onPointerMove={event => { if (event.pointerType === "mouse") setActive(index); }} onClick={() => choose(index)}>
        <div><span className="phone-address-family">{family(address)}{index === 0 && <small>默认</small>}</span><code>{address}</code></div>
        {value === address && <Icon name="check" />}
      </div>)}
    </div>, host)}
  </>;
}
