import { useEffect, useLayoutEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Icon } from "../Icon.js";
import { desktopInvoke } from "./desktop-bridge.js";
import { IconButton } from "./StartupControls.js";
type Peer = { name: string; ip: string };
export default function DeviceSelect({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState({ above: false, height: 280 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const alive = useRef(true);
  const id = useId();
  const options = [{ value: "local", name: "本地电脑", detail: "在这台电脑上运行", icon: "monitor" }, ...peers.map(peer => ({ value: peer.ip, name: peer.name, detail: peer.ip, icon: "server" })), ...(value !== "local" && value !== "manual" && !peers.some(peer => peer.ip === value) ? [{ value, name: "上次连接", detail: value, icon: "server" }] : []), { value: "manual", name: "手动输入地址", detail: "连接其他 Tailscale 设备", icon: "plus" }];
  const selected = options.find(option => option.value === value) || options[0];
  async function refresh() {
    if (pending.current) return;
    pending.current = true; setLoading(true); setError("");
    try {
      const result = await desktopInvoke<{ peers: Peer[] }>("axiom_peers");
      if (!Array.isArray(result?.peers)) throw Error("设备列表暂时不可用，请重新读取。");
      if (alive.current) setPeers(result.peers.filter(peer => typeof peer?.ip === "string" && typeof peer.name === "string"));
    } catch (cause) { if (alive.current) setError(String(cause instanceof Error ? cause.message : cause)); }
    finally { pending.current = false; if (alive.current) setLoading(false); }
  }
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("focusin", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("focusin", close); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const box = root.current?.getBoundingClientRect(); if (!box) return;
      const below = window.innerHeight - box.bottom - 20, above = box.top - 20;
      const upwards = below < 220 && above > below;
      setPlacement({ above: upwards, height: Math.max(80, upwards ? above : below) });
    };
    measure(); window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { if (open) root.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active, open]);
  function choose(index: number) { const option = options[index]; if (!option || disabled) return; onChange(option.value); setOpen(false); trigger.current?.focus(); }
  function key(event: KeyboardEvent) {
    if (event.key === "Escape") return;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); if (!open) { setOpen(true); setActive(Math.max(0, options.findIndex(item => item.value === value))); }
      else setActive(index => event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if ((event.key === "Enter" || event.key === " ") && open) { event.preventDefault(); choose(active); }
  }
  return <div className="device-picker-row"><div ref={root} className="device-picker" onKeyDown={event => { if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus({ preventScroll: true }); } }}>
    <button ref={trigger} type="button" className="device-trigger" role="combobox" aria-label="连接设备" aria-expanded={open} aria-controls={id} aria-activedescendant={open ? `${id}-${active}` : undefined} aria-haspopup="listbox" disabled={disabled} onKeyDown={key} onClick={() => { setActive(Math.max(0, options.findIndex(item => item.value === value))); setOpen(!open); }}>
      <span className="device-symbol"><Icon name={selected.icon} /></span><span className="device-name"><strong>{selected.name}</strong><small>{selected.detail}</small></span><span className="device-kind">{value === "local" ? "本地" : "TAILSCALE"}</span><Icon name="chevrons-up-down" />
    </button>
    {open && <div className="device-menu" data-above={placement.above} style={{ "--device-menu-space": `${placement.height}px` } as CSSProperties}><div className="device-menu-caption"><div>选择连接设备 <span>{loading ? "正在读取…" : `${peers.length} 台远程设备在线`}</span></div><IconButton label="刷新设备" icon="refresh-cw" spinning={loading} disabled={loading || disabled} onClick={() => void refresh()} /></div><div id={id} role="listbox" aria-label="连接设备列表" className="device-options">{options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={value === option.value} data-option-index={index} data-active={active === index} className="device-option" onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}><Icon name={option.icon} /><span><strong>{option.name}</strong><small>{option.detail}</small></span>{index > 0 && option.value !== "manual" && <i aria-label="设备在线" className={peers.some(peer => peer.ip === option.value) ? "peer-online" : "peer-unknown"} />}{value === option.value && <Icon name="check" className="device-selected" />}</div>)}</div>{error && <p className="device-discovery-error" role="status">{error} 本地连接和手动输入仍可使用。</p>}</div>}
  </div></div>;
}
