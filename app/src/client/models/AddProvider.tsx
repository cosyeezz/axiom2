import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopup } from "../useAnchoredPopup.js";
import { Select } from "../Select.js";
import { ProviderProxyFields } from "./ProviderProxyFields.js";
import { Icon } from "../components.js";
import type { ModelConfiguration, ProviderProxy } from "../../shared/models.js";
import { openAIProviderId } from "../../shared/model-providers.js";

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
      // macOS WebViews can blur a button with no next focus target on mousedown.
      // Keep the menu mounted for its click; outside pointers, Tab and window blur
      // already dismiss it when focus genuinely leaves the interaction.
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && !menu.current?.contains(event.relatedTarget as Node)) setOpen(false);
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

export function AddProvider({ templates, connections, blocked, login, close, accountAddition = false }: {
  templates: ModelConfiguration["templates"];
  connections: ModelConfiguration["providers"];
  blocked: boolean;
  login: (providerId: string, proxy: ProviderProxy, type: "oauth" | "api_key") => void;
  close: () => void;
  accountAddition?: boolean;
}) {
  // OpenAI's default OAuth is Codex. Keep existing direct/API-key connections
  // intact, but never offer a second OpenAI grant for new subscription logins.
  const providers = templates.filter((template) => template.id !== "openai" && template.methods?.includes("oauth"));
  if (accountAddition) for (const connection of connections) {
    if (connection.auth?.methods.includes("api_key") && !providers.some(template => template.id === connection.providerId))
      providers.push({ id: connection.providerId, name: connection.name, api: connection.api, url: connection.url, methods: connection.auth.methods });
  }
  const [selected, setSelected] = useState(openAIProviderId), [selectedMethod, setSelectedMethod] = useState<"oauth" | "api_key">("oauth");
  const providerId = providers.some((provider) => provider.id === selected) ? selected : (providers[0]?.id ?? "");
  const methods: ("oauth" | "api_key")[] = accountAddition ? providers.find(provider => provider.id === providerId)?.methods ?? ["oauth" as const] : ["oauth" as const];
  const type = methods.includes(selectedMethod) ? selectedMethod : methods[0] ?? "oauth";
  const [proxies, setProxies] = useState<Record<string, ProviderProxy>>({});
  const proxy = proxies[providerId] ?? connections.find(p => p.providerId === providerId)?.proxy ?? { mode: "direct" as const };
  return (
    <section className="oauth-provider-setup" aria-labelledby="oauth-add-title">
      <div className="detail-heading oauth-setup-heading"><div><span className="section-eyebrow">账号授权</span><h2 id="oauth-add-title">{accountAddition ? "添加独立账号" : "OAuth 登录"}</h2></div><span className="tag">{accountAddition ? "不覆盖原账号" : "无需 API Key"}</span></div>
      <div className="oauth-setup-fields">
        <p className="oauth-intro">{accountAddition ? "选择供应商，复用 Auth 登录；保存成功后返回多账号管理。新自定义接口请先通过供应商旁的 + 添加并保存连接配置。" : "连接已有账号，在浏览器完成授权后返回这里。"}</p>
        <div className="field">
          <label htmlFor="oauth-provider-select">供应商</label>
          <Select autoFocus id="oauth-provider-select" label="供应商" value={providerId} disabled={!providers.length} onChange={setSelected}
            options={providers.length ? providers.map(provider => ({ value: provider.id, label: provider.name })) : [{ value: "", label: "暂无可用供应商" }]} />
          <p className="field-help">供应商列表来自 pi；无需填写接口地址或协议。</p>
        </div>
        {accountAddition && methods.length > 1 && <div className="field"><label htmlFor="account-login-method">登录方式</label><Select id="account-login-method" label="账号登录方式" value={type} onChange={value => setSelectedMethod(value as "oauth" | "api_key")}
          options={methods.map(method => ({ value: method, label: method === "oauth" ? "OAuth 授权" : "API Key" }))} /></div>}
        {type === "oauth" && <ProviderProxyFields value={proxy} onChange={value => setProxies(previous => ({ ...previous, [providerId]: value }))}
          disabled={blocked || !providerId} label="授权与模型代理"
          help={accountAddition ? "此网络设置由同一供应商的所有账号共用；浏览器仍使用自身网络设置，本地回调保持直连。" : "登录时保存此选择，用于后台认证和后续模型请求。浏览器仍使用自身网络设置，本地回调保持直连，无需开启 TUN。"} />}
        {!providers.length && <p className="auth-error" role="status">当前后台未返回可用的 OAuth 供应商，请更新或重启后台服务，再重新读取配置。</p>}
        {blocked && <p className="auth-error" role="status">请先保存或放弃当前草稿，再登录账号。</p>}
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={blocked || !providerId} onClick={() => login(providerId, proxy, type)}>{type === "oauth" ? "浏览器登录" : "API Key 登录"}</button>
          <button type="button" className="btn btn-ghost" onClick={close}>取消添加</button>
        </div>
      </div>
    </section>
  );
}
