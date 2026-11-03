import { useEffect, useRef } from "react";
import { ProviderProxyFields } from "./ProviderProxyFields.js";
import { LocalPath } from "../LocalPath.js";
import { Select } from "../Select.js";
import { ComboInput } from "../ComboInput.js";
import type { ProviderDraft as Provider, ModelConfiguration } from "../../shared/models.js";
import { Headers, BodyOverrides } from "./Overrides.js";

export function ProviderConnection({ p, storage, tab, templates, patch, dirty, editor, busy, needsReconcile, feedback, removeProvider }: {
  p: Provider; storage: ModelConfiguration["storage"]; tab: string; templates: ModelConfiguration["templates"];
  patch: (p: Partial<Provider>) => void; dirty: boolean; editor: unknown; busy: boolean; needsReconcile: boolean;
  feedback: string; removeProvider: (p: Provider) => void;
}) {
  const providerIdInput = useRef<HTMLInputElement>(null), oauth = p.connectionType === "oauth";
  useEffect(() => { if (!p.originalId) providerIdInput.current?.focus(); }, [p.id, p.originalId]);
  return <div id="suppliers-screen" role="tabpanel" aria-labelledby="suppliers-tab" hidden={tab !== "suppliers"}>
    <form id="provider-form" onSubmit={event => event.preventDefault()}>
      <section className="section">
        <div className="section-heading"><h3>连接与请求</h3><p>这些设置由此连接下所有账号共用。认证请在「账号与认证」中管理，模型专属覆盖仍在模型编辑器中。</p></div>
        <div className="connection-fields">
          <div className="grid-2">
            <div className="field"><label htmlFor="provider-id">供应商 ID</label>
              {p.originalId || oauth ? <input className="input num" id="provider-id" value={p.providerId} readOnly /> :
                <ComboInput id="provider-id" inputRef={providerIdInput} className="num" label="供应商 ID" value={p.providerId} maxLength={160}
                  options={templates.map(template => template.id)} optionLabel={id => { const template = templates.find(item => item.id === id); return template ? `${id} · ${template.name}` : id; }}
                  onChange={providerId => { const template = templates.find(item => item.id === providerId); patch({ providerId, ...(template ? { name: template.name, api: template.api, url: template.url } : {}) }); }} />}
              <span className="field-help">保存后不可修改；不同端点或协议可使用不同自定义 ID。</span>
            </div>
            <div className="field"><label htmlFor="provider-name">供应商名称</label><input className="input" id="provider-name" required maxLength={80} value={p.name} onChange={event => patch({ name: event.target.value })} /></div>
          </div>
          {oauth ? <div className="field-help"><p>OAuth 使用供应商原生协议与端点，不将原生登录转换为通用 API Key 接口。</p>
            {p.hasConnectionOverrides && <p>保留已有接口覆盖。协议：{p.api}；地址：{p.keepUrl ? "已保存敏感地址" : p.url || "供应商默认"}。</p>}</div>
            : <div className="grid-2 connection-endpoint">
              <div className="field"><label htmlFor="provider-protocol">接口协议</label><Select id="provider-protocol" label="接口协议" value={p.api} disabled={busy || needsReconcile} onChange={api => patch({ api })} options={[
                { value: "openai-completions", label: "OpenAI 兼容" }, { value: "openai-responses", label: "OpenAI Responses" },
                ...(!["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"].includes(p.api) ? [{ value: p.api, label: p.api }] : []),
                { value: "anthropic-messages", label: "Anthropic" }, { value: "google-generative-ai", label: "Google Gemini" },
              ]} /></div>
              <div className="field"><label htmlFor="provider-url">接口地址</label><input className="input num" id="provider-url" type="url" required maxLength={2048} spellCheck={false}
                placeholder={p.keepUrl ? "已保存敏感地址；留空保留，输入替换" : "https://api.example.com/v1"} value={p.url} onChange={event => patch({ url: event.target.value, keepUrl: false })} />
                <span className="field-help">基础地址支持 HTTP / HTTPS。</span></div>
            </div>}
          <ProviderProxyFields value={p.proxy} onChange={proxy => patch({ proxy })} disabled={busy || needsReconcile} error={p.auth?.error} />
          {!p.originalId && <p className="field-help">先保存连接，再到「账号与认证」新增 API Key 或 OAuth 账号。无需认证的本地接口也可直接使用。</p>}
        </div>
      </section>
      <div className="override-grid"><Headers rows={p.headers} change={headers => patch({ headers })} scope="provider" /><BodyOverrides rows={p.body} change={body => patch({ body })} api={p.api} /></div>
      <p className="field-help">普通请求头按原设置发送。API Key 认证头可用 <code>{"{{account.key}}"}</code> 或 <code>{"Bearer {{account.key}}"}</code> 引用所选账号；OAuth 请使用供应商原生认证。已有写死认证头不会被删除，但与所选账号冲突时会阻止请求。</p>
      <div className="save-bar"><div>{storage && <p className="meta credential-path">模型配置位置：<LocalPath path={storage.modelsPath} /></p>}<p className="feedback" role="status">{feedback}</p></div>
        <button type="button" className="btn btn-ghost" disabled={!!p.originalId && (dirty || !!editor || busy || needsReconcile)} data-tooltip="先删除此连接下的账号，再移除连接配置" onClick={() => removeProvider(p)}>移除连接</button></div>
    </form>
    <p className="prototype-note">保存连接不会新增或替换账号凭据。认证与配置保存在服务端，保存成功不代表远端模型调用已验证。</p>
  </div>;
}
