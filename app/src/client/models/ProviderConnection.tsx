import { useEffect, useRef } from "react";
import type {
  ProviderDraft as Provider,
  ModelConfiguration,
} from "../../shared/models.js";
import { Headers, BodyOverrides } from "./Overrides.js";
export function ProviderConnection({
  p,
  storage,
  tab,
  templates,
  patch,
  showKey,
  setShowKey,
  dirty,
  editor,
  busy,
  needsReconcile,
  setLogin,
  feedback,
  logoutProvider,
  removeProvider,
}: {
  p: Provider;
  storage: ModelConfiguration["storage"];
  tab: string;
  templates: ModelConfiguration["templates"];
  patch: (p: Partial<Provider>) => void;
  showKey: boolean;
  setShowKey: (v: boolean) => void;
  dirty: boolean;
  editor: unknown;
  busy: boolean;
  needsReconcile: boolean;
  setLogin: (v: { providerId: string; type: "api_key" | "oauth" }) => void;
  feedback: string;
  logoutProvider: (p: Provider) => void;
  removeProvider: (p: Provider) => void;
}) {
  const providerIdInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!p.originalId) providerIdInput.current?.focus();
  }, [p.id, p.originalId]);
  if (p.connectionType === "oauth") return (
    <div id="suppliers-screen" role="tabpanel" aria-labelledby="suppliers-tab" hidden={tab !== "suppliers"}>
      <section className="section">
        <div className="section-heading"><h3>OAuth 连接</h3><p>使用供应商账号授权，无需填写 API 密钥、接口地址或协议。</p></div>
        <div className="connection-fields oauth-account-fields">
          <div className="field"><label htmlFor="provider-name">供应商名称</label><input className="input" id="provider-name" maxLength={80} value={p.name} onChange={(e) => patch({ name: e.target.value })} /></div>
          <p className="meta">供应商：{p.providerId}</p>
          <p id="provider-auth-status" className="connection-status" data-configured={p.auth?.configured || false} role="status">{p.auth?.configured ? "已通过 OAuth 登录" : "尚未登录，请完成账号授权。"}</p>
          {p.hasConnectionOverrides && <p className="field-help">此连接保留已有自定义接口覆盖，登录不会修改原配置。协议：{p.api}；地址：{p.keepUrl ? "已保存敏感地址" : p.url}</p>}
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={dirty || !!editor || busy || needsReconcile} onClick={() => setLogin({ providerId: p.providerId, type: "oauth" })}>OAuth 登录</button>
            <button type="button" className="btn btn-ghost" disabled={dirty || !!editor || busy || needsReconcile} onClick={() => removeProvider(p)}>退出登录并移除</button>
          </div>
          {dirty && <p className="field-help">请先保存或放弃当前草稿，再重新登录或移除账号。</p>}
          {storage && <p className="meta credential-path">凭据保存位置：<code>{storage.authPath}</code></p>}
        </div>
      </section>
      <p className="prototype-note">账号凭据仅保存在服务端。登录成功后可到「模型配置」拉取和选择模型，调用权限以供应商账号为准。</p>
    </div>
  );
  return (
    <div
      id="suppliers-screen"
      role="tabpanel"
      aria-labelledby="suppliers-tab"
      hidden={tab !== "suppliers"}
    >
      <form id="provider-form" onSubmit={(e) => e.preventDefault()}>
        <section className="section">
          <div className="section-heading">
            <h3>自定义接口</h3>
            <p>填写连接信息，完成后在下方统一保存。</p>
          </div>
          <div className="connection-fields">
            <div className="grid-2">
            <div className="field">
              <label htmlFor="provider-id">供应商 ID</label>
              <input
                className="input num"
                id="provider-id"
                ref={providerIdInput}
                list="provider-templates"
                value={p.providerId}
                readOnly={!!p.originalId}
                maxLength={160}
                onChange={(e) => {
                  const template = templates.find(
                    (t) => t.id === e.target.value,
                  );
                  patch({
                    providerId: e.target.value,
                    ...(template
                      ? {
                          name: template.name,
                          api: template.api,
                          url: template.url,
                        }
                      : {}),
                  });
                }}
              />
              <datalist id="provider-templates">
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </datalist>
              <span className="field-help">
                选择内置 ID 或自定义；保存后不可修改。
              </span>
            </div>
              <div className="field">
                <label htmlFor="provider-name">供应商名称</label>
                <input
                  className="input"
                  id="provider-name"
                  required
                  maxLength={80}
                  value={p.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </div>
            </div>
            <div className="grid-2 connection-endpoint">
              <div className="field">
                <label htmlFor="provider-protocol">接口协议</label>
                <select
                  className="input"
                  id="provider-protocol"
                  value={p.api}
                  onChange={(e) => patch({ api: e.target.value })}
                >
                  <option value="openai-completions">OpenAI 兼容</option>
                  <option value="openai-responses">OpenAI Responses</option>
                  {![
                    "openai-completions",
                    "openai-responses",
                    "anthropic-messages",
                    "google-generative-ai",
                  ].includes(p.api) && <option value={p.api}>{p.api}</option>}
                  <option value="anthropic-messages">Anthropic</option>
                  <option value="google-generative-ai">Google Gemini</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="provider-url">接口地址</label>
                <input
                  className="input num"
                  id="provider-url"
                  type="url"
                  required
                  maxLength={2048}
                  spellCheck={false}
                  placeholder={
                    p.keepUrl
                      ? "已保存敏感地址；留空保留，输入替换"
                      : "https://api.example.com/v1"
                  }
                  value={p.url}
                  onChange={(e) =>
                    patch({ url: e.target.value, keepUrl: false })
                  }
                />
                <span className="field-help">
                  填写基础地址，支持 HTTP / HTTPS。
                </span>
              </div>
            </div>
            <div className="connection-credentials">
              <div className="field">
                <div className="row-between credential-heading">
                  <label htmlFor="provider-key">
                    API 密钥 <span className="meta">（可选）</span>
                  </label>
                  <button
                    id="logout-provider"
                    className="btn btn-ghost"
                    type="button"
                    disabled={!p.originalId || !p.auth?.configured || dirty || !!editor || busy || needsReconcile}
                    onClick={() => logoutProvider(p)}
                    data-tooltip={dirty || editor ? "请先保存或放弃修改，再退出认证" : "立即退出认证，保留供应商和模型"}
                  >退出认证</button>
                </div>
                <div className="key-field">
                  <input
                    className="input num"
                    id="provider-key"
                    type={showKey ? "text" : "password"}
                    autoComplete="off"
                    maxLength={4096}
                    spellCheck={false}
                    placeholder={
                      p.auth?.source === "stored" && p.auth.type === "api_key"
                          ? "••••••••（已保存，输入可替换）"
                          : p.auth?.configured
                            ? "已配置认证；留空保持不变"
                            : "输入 API 密钥"
                    }
                    aria-describedby="provider-key-status"
                    value={p.key}
                    onChange={(e) =>
                      patch({
                        key: e.target.value,
                        clearKey: false,
                      })
                    }
                  />
                  <button
                    className="icon-btn"
                    type="button"
                    aria-label={showKey ? "隐藏 API 密钥" : "显示 API 密钥"}
                    aria-pressed={showKey}
                    onClick={() => setShowKey(!showKey)}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                </div>
                <span className="field-help" id="provider-key-status" role="status">
                  {p.key
                      ? "新密钥尚未保存，请点击下方「保存」。"
                      : p.auth?.source === "stored" && p.auth.type === "api_key"
                        ? "API 密钥已保存到本地。为保护密钥不显示原文，留空保持不变。"
                        : p.auth?.source === "stored" && p.auth.type === "oauth"
                          ? "已保存 OAuth 登录凭据；留空保持当前认证。"
                          : "输入密钥后点击下方「保存」；留空保持原认证。"}
                </span>
                {p.auth?.configured && <p className="field-help">退出立即生效，并清除该供应商及模型的请求头覆盖、地址参数和内嵌凭据。</p>}
                {(dirty || !!editor) && p.auth?.configured && <p className="field-help">退出前请先保存或放弃当前修改。</p>}
                <details className="credential-details">
                  <summary>凭据存储位置</summary>
                  <div className="credential-details-content">
                {storage && (
                  <span className="field-help credential-path">
                    密钥保存位置：<code>{storage.authPath}</code>
                  </span>
                )}
                <span className="field-help">
                  认证来源：{p.auth?.source === "stored" ? "本地保存" : p.auth?.source === "environment" ? "环境变量" : p.auth?.configured ? "配置或运行环境" : "未配置"}
                </span>
                  </div>
                </details>
              </div>
            </div>
          </div>
        </section>
        <div className="override-grid">
          <Headers
            rows={p.headers}
            change={(headers) => patch({ headers })}
            scope="provider"
          />
          <BodyOverrides
            rows={p.body}
            change={(body) => patch({ body })}
            api={p.api}
          />
        </div>
        <div className="save-bar">
          <div>
            {storage && (
              <p className="meta credential-path">
                模型配置位置：<code>{storage.modelsPath}</code>
              </p>
            )}
            <p className="feedback" role="status">
              {feedback}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={
              !!p.originalId && (dirty || !!editor || busy || needsReconcile)
            }
            data-tooltip={
              dirty && p.originalId
                ? "请先保存或放弃未保存修改，再删除供应商"
                : "确认后删除供应商并退出登录"
            }
            onClick={() => removeProvider(p)}
          >
            删除供应商
          </button>
        </div>
      </form>
      <p className="prototype-note">
        API Key 与 OAuth 使用 pi
        原生认证流程，凭据仅保存在服务端。保存或登录成功不代表远端模型调用已验证。
      </p>
    </div>
  );
}
