import { Select } from "../Select.js";
import { useScope } from "../transport.js";
import { emptyModelProxyState } from "../../shared/model-proxy.js";
import type { ProviderProxy } from "../../shared/models.js";

export function ProviderProxyFields({ value = { mode: "direct" }, onChange, disabled, error }: {
  value?: ProviderProxy; onChange: (value: ProviderProxy) => void; disabled: boolean; error?: string;
}) {
  const state = useScope("builtin-tools:model-proxy", emptyModelProxyState);
  const selected = value.mode === "builtin" ? state.profiles.find(p => p.id === value.profileId) : undefined;
  return <div className="field provider-proxy-fields">
    <label htmlFor="provider-proxy-mode">模型代理</label>
    <Select id="provider-proxy-mode" label="模型代理" value={value.mode} disabled={disabled} options={[
      { value: "direct", label: "直连（默认）" }, { value: "external", label: "填写代理地址" }, { value: "builtin", label: "使用内置代理" },
    ]} onChange={mode => onChange(mode === "external" ? { mode, url: "" } : mode === "builtin" ? { mode, profileId: state.profiles[0]?.id ?? "" } : { mode: "direct" })} />
    {value.mode === "external" && <>
      <label htmlFor="provider-proxy-url">HTTP / HTTPS 代理地址</label>
      <input id="provider-proxy-url" className="input num" type="password" autoComplete="off" spellCheck={false} maxLength={2048} disabled={disabled}
        value={value.url} placeholder={value.keepUrl ? "已保存含凭据的地址；留空保留，输入替换" : "http://127.0.0.1:7890"}
        onChange={e => onChange({ mode: "external", url: e.target.value, ...(value.keepUrl && !e.target.value ? { keepUrl: true } : {}) })} />
      <p className="field-help">填写桌面代理软件的 HTTP 或混合端口。无需安装内置内核；远程地址可包含代理账号密码。</p>
    </>}
    {value.mode === "builtin" && <>
      <label htmlFor="provider-proxy-profile">内置线路</label>
      <Select id="provider-proxy-profile" label="内置线路" value={value.profileId} disabled={disabled} options={[
        ...(!selected ? [{ value: value.profileId, label: value.profileId ? "原线路已不存在，请重新选择" : "请先添加线路" }] : []),
        ...state.profiles.map(p => ({ value: p.id, label: `${p.name} · ${p.status === "running" ? "运行中" : p.status === "starting" ? "启动中" : p.status === "error" ? "异常" : "已停止"}` })),
      ]} onChange={profileId => onChange({ mode: "builtin", profileId })} />
      <p className="field-help"><a href="/tools.html#model-proxy">管理内置代理</a>，安装内核、添加并启动线路。线路停止或连接失败时，请求会报错。</p>
    </>}
    <p className="field-help">保存后用于此供应商的模型调用、模型列表和登录请求。本机与局域网模型保持直连。</p>
    {error && <p className="feedback" role="status">{error}</p>}
  </div>;
}
