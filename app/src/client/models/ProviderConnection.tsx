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
  removeProvider: (p: Provider) => void;
}) {
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
            <h3>连接信息</h3>
            <p>顶部保存统一发布；密钥通过 pi 原生认证接口管理。</p>
          </div>
          <div className="connection-fields">
            <div className="field">
              <label htmlFor="provider-id">供应商 ID</label>
              <input
                className="input num"
                id="provider-id"
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
                稳定的 pi 供应商标识；使用内置供应商认证时选择对应
                ID，保存后不可修改。
              </span>
            </div>
            <div className="grid-2">
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
            </div>
            <div className="grid-2">
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
              <div className="field">
                <label htmlFor="provider-key">
                  API 密钥 <span className="meta">（可选）</span>
                </label>
                <div className="key-field">
                  <input
                    className="input num"
                    id="provider-key"
                    type={showKey ? "text" : "password"}
                    autoComplete="off"
                    maxLength={4096}
                    spellCheck={false}
                    placeholder={
                      p.clearKey
                        ? "保存后清除认证"
                        : p.auth?.source === "stored" && p.auth.type === "api_key"
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
                  {p.clearKey
                    ? "待清除认证，保存后生效。"
                    : p.key
                      ? "新密钥尚未保存，请点击顶部「保存」。"
                      : p.auth?.source === "stored" && p.auth.type === "api_key"
                        ? "API 密钥已保存到本地。为保护密钥不显示原文，留空保持不变。"
                        : p.auth?.source === "stored" && p.auth.type === "oauth"
                          ? "已保存 OAuth 登录凭据；留空保持当前认证。"
                          : "输入密钥后点击顶部「保存」；留空保持原认证。"}
                </span>
                {storage && (
                  <span className="field-help credential-path">
                    密钥保存位置：<code>{storage.authPath}</code>
                  </span>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={p.clearKey === true}
                    onChange={(e) =>
                      patch({
                        clearKey: e.target.checked,
                        key: "",
                      })
                    }
                  />{" "}
                  保存时退出此供应商并清除受管理认证
                </label>
                <span className="field-help">
                  认证来源：{p.auth?.source || "无"} {p.auth?.type || ""}
                </span>
                <div className="row">
                  {p.auth?.methods.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="btn btn-ghost"
                      disabled={dirty || !!editor || busy || needsReconcile}
                      onClick={() =>
                        setLogin({
                          providerId: p.providerId,
                          type,
                        })
                      }
                    >
                      {type === "oauth" ? "OAuth 登录" : "API Key 登录"}
                    </button>
                  ))}
                </div>
                {dirty && (
                  <span className="field-help">
                    单独登录前请先保存或放弃配置修改。
                  </span>
                )}
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
            <p className="meta">
              统一点击顶部「保存」后发布。草稿仅保留在本页内存。
            </p>
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
            title={
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
