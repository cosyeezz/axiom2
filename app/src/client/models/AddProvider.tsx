import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopup } from "../useAnchoredPopup.js";
import { Select } from "../Select.js";
import { Icon } from "../components.js";
import type { ModelConfiguration } from "../../shared/models.js";

export function ProviderAddMenu({ disabled, oauth, custom }: {
  disabled: boolean;
  oauth: () => void;
  custom: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const { panel: menu, host } = useAnchoredPopup(open ? trigger.current : null, { maxWidth: 168, maxHeight: 160, preferBelow: true });
  const close = (restore = false) => {
    setOpen(false);
    if (restore) trigger.current?.focus();
  };
  useLayoutEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [open, menu]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const blur = () => close(true);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("blur", blur);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("blur", blur); };
  }, [open, menu]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return (
    <div className="provider-add-control" ref={root} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !menu.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
    }} onKeyDown={(event) => {
      if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(true); }
    }}>
      <button ref={trigger} className="btn btn-ghost add-supplier action-icon" id="add-supplier" type="button"
        aria-label="添加供应商" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? "provider-add-menu" : undefined}
        disabled={disabled} onClick={() => setOpen(!open)} onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); }
        }}><Icon name="plus" /></button>
      {open && createPortal(<div ref={menu} id="provider-add-menu" className="provider-add-menu" popover="manual" role="menu" aria-label="接入方式" onKeyDown={(event) => {
        if (event.key === "Tab") { close(true); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }}>
        <button type="button" role="menuitem" onClick={() => { close(); oauth(); }}>OAuth 登录</button>
        <button type="button" role="menuitem" onClick={() => { close(); custom(); }}>自定义接口</button>
      </div>, host)}    </div>
  );
}

export function AddProvider({ templates, blocked, login, close }: {
  templates: ModelConfiguration["templates"];
  blocked: boolean;
  login: (providerId: string) => void;
  close: () => void;
}) {
  const providers = templates.filter((template) => template.methods?.includes("oauth"));
  const [selected, setSelected] = useState("");
  const providerId = providers.some((provider) => provider.id === selected) ? selected : (providers[0]?.id ?? "");
  return (
    <section className="oauth-provider-setup" aria-labelledby="oauth-add-title">
      <div className="detail-heading oauth-setup-heading"><div><span className="section-eyebrow">账号授权</span><h2 id="oauth-add-title">OAuth 登录</h2></div><span className="tag">无需 API Key</span></div>
      <div className="oauth-setup-fields">
        <p className="oauth-intro">连接已有账号，在浏览器完成授权后返回这里。</p>
        <div className="field">
          <label htmlFor="oauth-provider-select">供应商</label>
          <Select autoFocus id="oauth-provider-select" label="供应商" value={providerId} disabled={!providers.length} onChange={setSelected}
            options={providers.length ? providers.map(provider => ({ value: provider.id, label: `${provider.name} · ${provider.id}` })) : [{ value: "", label: "暂无可用供应商" }]} />
          <p className="field-help">供应商列表来自 pi；无需填写接口地址或协议。</p>
        </div>
        {!providers.length && <p className="auth-error" role="status">当前后台未返回可用的 OAuth 供应商，请更新或重启后台服务，再重新读取配置。</p>}
        {blocked && <p className="auth-error" role="status">请先保存或放弃当前草稿，再登录账号。</p>}
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={blocked || !providerId} onClick={() => login(providerId)}>浏览器登录</button>
          <button type="button" className="btn btn-ghost" onClick={close}>取消添加</button>
        </div>
      </div>
    </section>
  );
}
