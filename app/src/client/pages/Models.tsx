import { useRef, useState } from "react";
import { AddProvider, ProviderAddMenu } from "../models/AddProvider.js";
import { Icon, Dialog, SettingsSidebar } from "../components.js";
import { ModelLogin } from "./ModelLogin.js";
import { ProviderConnection } from "../models/ProviderConnection.js";
import { ModelRegistry } from "../models/ModelRegistry.js";
import { useConfiguration } from "../models/useConfiguration.js";
import { SettingsHeader } from "../settings/SettingsHeader.js";
import "../styles/settings.css";
import "../styles/model-interactions.css";
export default function Models() {
  const [adding, setAdding] = useState(false);
  const supplierSearch = useRef<HTMLInputElement>(null);
  const {
    config,
    connection,
    revision,
    storage,
    saved,
    templates,
    dirty,
    busy,
    needsReconcile,
    login,
    setLogin,
    providers,
    selected,
    query,
    setQuery,
    filter,
    setFilter,
    tab,
    editor,
    setEditor,
    showKey,
    setShowKey,
    feedback,
    feedbackError,
    copyFeedback,
    decision,
    setDecision,
    p,
    load,
    refreshAuthentication,
    save,
    patch,
    discardEditor,
    stageEditor,
    add,
    select,
    logoutProvider,
    removeProvider,
    changeTab,
    copyButton,
    rows,
  } = useConfiguration();
  const hasError = feedback ? feedbackError : !!config.error;
  const filteredProviders = providers.filter((provider) =>
    `${provider.name} ${provider.providerId}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="settings-app models-workspace" data-feedback-error={hasError}>
      <SettingsSidebar page="models" />
      <main className="settings-main" id="content">
        <SettingsHeader page="models" />
        <span className="configuration-progress" role="status" aria-live="polite" aria-atomic="true">
          {busy && !hasError ? feedback : ""}
        </span>
        {hasError && <p
          className="configuration-feedback configuration-global-error"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          data-saved={false}
          data-error={true}
        >
          <strong className="configuration-error-label">配置错误 · </strong>
          {feedback || config.error}
        </p>}
        <div className="container" inert={busy} aria-busy={busy}>
          <div className="configuration-layout">
            <section
              className="supplier-panel"
              aria-labelledby="supplier-heading"
            >
              <div className="supplier-toolbar">
                <h2 id="supplier-heading">
                  供应商 <span className="meta num">{providers.length}</span>
                </h2>
                <ProviderAddMenu
                  disabled={!revision || needsReconcile || busy || !!login}
                  oauth={() => setAdding(true)}
                  custom={() => { setAdding(false); add(); }}
                />
              </div>
              <input
                type="search"
                className="input supplier-search"
                ref={supplierSearch}
                placeholder="搜索供应商"
                aria-label="搜索供应商"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="supplier-list">
                {filteredProviders.map((p) => (
                    <button
                      key={p.id}
                      className="supplier-option"
                      data-tooltip={p.name || "新供应商"}
                      data-configured={p.auth?.configured || false}
                      aria-current={!adding && selected === p.id}
                      disabled={!!login}
                      onClick={() => { setAdding(false); select(p.id); }}
                    >
                      <span>
                        <strong>
                          <span className="supplier-name">
                            {p.name || "新供应商"}
                          </span>
                          <span className="tag">{p.models.length}</span>
                        </strong>
                        <small>
                          <span className="supplier-status-dot" aria-hidden="true" />
                          {p.connectionType === "oauth" ? "OAuth" : "自定义接口"}
                          <span aria-hidden="true">·</span>
                          {p.originalId ? p.auth?.configured ? "已配置" : "未认证" : "未保存"}
                        </small>
                      </span>
                    </button>
                  ))}
                {!providers.length ? <p className="list-empty">暂无供应商</p> : !filteredProviders.length && <div className="list-empty">未找到供应商<button type="button" className="btn btn-ghost" onClick={() => { setQuery(""); supplierSearch.current?.focus(); }}>清除搜索</button></div>}
              </div>
            </section>
            <div className="supplier-detail">
              {login?.type === "oauth" ? (
                <ModelLogin
                  {...login}
                  inline
                  revision={revision}
                  onComplete={() => { void refreshAuthentication(login.providerId); }}
                  close={() => {
                    setLogin(null);
                    void refreshAuthentication(login.providerId).then(() => document.getElementById("add-supplier")?.focus());
                  }}
                />
              ) : adding ? (
                <AddProvider
                  templates={templates}
                  blocked={dirty || !!editor || busy || needsReconcile}
                  login={(providerId) => { setAdding(false); setLogin({ providerId, type: "oauth" }); }}
                  close={() => { setAdding(false); document.getElementById("add-supplier")?.focus(); }}
                />
              ) : !p ? (
                <div className="empty-details">
                  <h2>连接你的模型</h2>
                  <p>点击供应商旁的「+」，选择账号授权或自定义接口。</p>
                  <div className="empty-connection-types"><span>OAuth 账号登录</span><span>API Key / 本地接口</span></div>
                </div>
              ) : (
                <>
                  <div className="row-between detail-heading">
                    <div className="provider-heading-copy">
                      <h2>{p.name || "新供应商"}</h2>
                      <p className="meta provider-identity">
                        <code>{p.providerId}</code><span aria-hidden="true">·</span>
                        {p.models.length} 个模型
                      </p>
                    </div>
                    <span className="connection-badge" data-configured={p.auth?.configured || false}>
                      <span aria-hidden="true" />{p.auth?.configured ? "已配置认证" : "未认证"}
                    </span>
                  </div>
                  <nav
                    className="config-tabs"
                    role="tablist"
                    aria-label="当前供应商配置"
                    onKeyDown={(e) => {
                      if (
                        ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                          e.key,
                        )
                      ) {
                        e.preventDefault();
                        changeTab(
                          e.key === "Home"
                            ? "suppliers"
                            : e.key === "End"
                              ? "models"
                              : tab === "models"
                                ? "suppliers"
                                : "models",
                        );
                      }
                    }}
                  >
                    {["suppliers", "models"].map((id) => (
                      <button
                        className="config-tab"
                        id={`${id}-tab`}
                        key={id}
                        role="tab"
                        aria-selected={tab === id}
                        aria-controls={`${id}-screen`}
                        tabIndex={tab === id ? 0 : -1}
                        onClick={() => changeTab(id)}
                      >
                        {id === "suppliers" ? "连接配置" : "模型配置"}
                        {dirty && <span className="draft-indicator" aria-label="未保存" />}
                      </button>
                    ))}
                  </nav>
                  {p.auth?.error && !p.key.trim() && <p className="auth-error" role="alert">配置错误 · {p.auth.error}</p>}
                  <ProviderConnection
                    {...{
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
                      feedback: feedbackError ? feedback : "",
                      logoutProvider,
                      removeProvider,
                    }}
                  />
                  <ModelRegistry
                    key={p.id}
                    {...{
                      p,
                      revision,
                      dirty,
                      busy,
                      needsReconcile,
                      tab,
                      filter,
                      setFilter,
                      editor,
                      setEditor,
                      discardEditor,
                      stageEditor,
                      patch,
                      feedback: feedbackError ? feedback : "",
                      copyFeedback,
                      copyButton,
                      rows,
                      setDecision,
                    }}
                  />
                </>
              )}
              {!hasError && <p
                className="configuration-feedback"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                data-saved={saved}
                data-error={false}
              >
                {feedback || (connection !== "已连接本地服务" ? connection : "")}
              </p>}
              <footer className="configuration-actions" aria-label="配置操作">
                <button
                  className="btn btn-primary"
                  id="save-provider"
                  disabled={busy || !!login || needsReconcile || !dirty || !revision}
                  data-tooltip={needsReconcile ? "请先重新读取配置" : "统一保存所有供应商和模型的修改"}
                  onClick={() => void save()}
                >
                  保存
                </button>
                <button
                  className="btn btn-ghost"
                  id="reset-provider"
                  disabled={busy || !!login || (!dirty && !editor)}
                  onClick={() => setDecision({
                    title: "放弃修改？",
                    text: "丢弃本页所有草稿及临时密钥，重新读取已发布配置；不会改变服务端配置。",
                    proceed: () => void load(),
                  })}
                >
                  取消
                </button>
                <button
                  className="icon-btn config-reload"
                  type="button"
                  aria-label="重新读取配置"
                  data-tooltip="重新读取配置"
                  disabled={busy || !!login}
                  onClick={() => {
                    if (dirty || editor) setDecision({
                      title: "重新读取配置？",
                      text: "这会丢弃当前未保存修改和临时密钥。取消可继续编辑。",
                      proceed: () => void load(),
                    });
                    else void load();
                  }}
                >
                  <Icon name="rotate-cw" />
                </button>
                <span className="save-state" data-dirty={dirty} role="status">
                  {busy ? "处理中…" : dirty ? "有未保存修改" : saved ? "已保存到本地" : "无未保存修改"}
                </span>
              </footer>
            </div>
          </div>
        </div>
        {revision && config.revision && revision !== config.revision && (
          <p className="feedback" role="alert">
            服务端配置已更新；当前草稿未被覆盖。请重新读取后合并，过期保存会被拒绝。
          </p>
        )}
        {decision && (
          <Dialog
            title={decision.title}
            onClose={() => setDecision(null)}
            className="settings-dialog"
          >
            <p>{decision.text}</p>
            <div className="row dialog-actions">
              <button
                className="btn btn-ghost"
                onClick={() => setDecision(null)}
              >
                取消
              </button>
              <button
                className="btn"
                onClick={() => {
                  decision.proceed();
                  setDecision(null);
                }}
              >
                确认
              </button>
            </div>
          </Dialog>
        )}
      </main>
    </div>
  );
}
