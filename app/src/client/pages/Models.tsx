import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { AddProvider, ProviderAddMenu } from "../models/AddProvider.js";
import { Icon, SettingsSidebar } from "../components.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { ProviderConnection } from "../models/ProviderConnection.js";
import { ModelAccountRecovery } from "../models/ModelAccountRecovery.js";
import { MountOnVisit } from "../MountOnVisit.js";
import { useConfiguration } from "../models/useConfiguration.js";
import { SettingsHeader } from "../settings/SettingsHeader.js";
import "../styles/settings.css";
import "../styles/model-interactions.css";
const ModelLogin = lazy(() => import("./ModelLogin.js").then(module => ({ default: module.ModelLogin })));
const ModelRegistry = lazy(() => import("../models/ModelRegistry.js").then(module => ({ default: module.ModelRegistry })));
export default function Models() {
  const [accountAddition] = useState(() => new URLSearchParams(location.search).get("add-account") === "1");
  const [adding, setAdding] = useState(accountAddition);
  const [accountLabel, setAccountLabel] = useState(""), [accountRegion, setAccountRegion] = useState(""), [accountError, setAccountError] = useState("");
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
    editorDirty,
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
  const startLogin = (flow: NonNullable<typeof login>) => {
    if (accountAddition && !accountLabel.trim()) { setAccountError("请先填写账号名称。"); document.getElementById("account-label")?.focus(); return; }
    setAccountError(""); setAdding(false); setLogin(flow);
  };
  const hasError = feedback ? feedbackError : !!config.error;
  const loading = !revision && !hasError;
  const filteredProviders = useMemo(() => {
    if (query === "") return providers;
    const needle = query.toLowerCase();
    return providers.filter((provider) =>
      `${provider.name} ${provider.providerId}`.toLowerCase().includes(needle),
    );
  }, [providers, query]);
  return (
    <div className="settings-app models-workspace" data-feedback-error={hasError}>
      <SettingsSidebar page="models" />
      <main className="settings-main" id="content">
        <SettingsHeader page="models" />
        {accountAddition ? <section className="account-add-context" aria-label="独立添加账号">
          <div className="row-between"><h2>添加账号</h2><a href="/model-accounts.html">返回多账号管理</a></div>
          <p className="field-help">此入口独立保存新账号，不覆盖原账号；登录成功后自动返回，新供应商首个账号可直接使用。同一供应商共用连接和模型列表，不会为账号复制模型配置。</p>
          <div className="grid-2"><div className="field"><label htmlFor="account-label">账号名称</label><input id="account-label" className="input" required maxLength={160} value={accountLabel} disabled={!!login || busy} placeholder="工作账号 / 个人账号" onChange={event => setAccountLabel(event.target.value)} /></div>
            <div className="field"><label htmlFor="account-region">区域或备注</label><input id="account-region" className="input" maxLength={160} value={accountRegion} disabled={!!login || busy} placeholder="可选，不改变服务端点" onChange={event => setAccountRegion(event.target.value)} /></div></div>
          {accountError && <p role="alert" className="auth-error">{accountError}</p>}
        </section> : <p className="field-help"><a href="/model-accounts.html">多账号管理 →</a> 单账号在此管理；直接登录会替换当前账号，需要保留多个账号时请使用多账号管理。</p>}
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
        {!hasError && config.warning && <p className="configuration-feedback" role="status">{config.warning}</p>}
        <div className="container" inert={busy} aria-busy={busy}>
          <div className="configuration-layout">
            <section
              className="supplier-panel"
              aria-labelledby="supplier-heading"
            >
              <div className="supplier-toolbar">
                <h2 id="supplier-heading">
                  供应商 <span className="meta num">{loading ? "…" : providers.length}</span>
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
                {!providers.length ? <p className="list-empty">{loading ? "正在读取本地配置…" : "暂无供应商"}</p> : !filteredProviders.length && <div className="list-empty">未找到供应商<button type="button" className="btn btn-ghost" onClick={() => { setQuery(""); supplierSearch.current?.focus(); }}>清除搜索</button></div>}
              </div>
            </section>
            <div className="supplier-detail">
              {login ? (
                <Suspense fallback={<p role="status">正在加载登录界面…</p>}>
                <ModelLogin
                  {...login}
                  inline
                  revision={revision}
                  account={accountAddition ? { label: accountLabel.trim(), region: accountRegion.trim() } : undefined}
                  onComplete={() => { if (accountAddition) location.replace("/model-accounts.html?added=1"); else void refreshAuthentication(login.providerId); }}
                  close={() => {
                    setLogin(null);
                    void refreshAuthentication(login.providerId).then(() => document.getElementById("add-supplier")?.focus());
                  }}
                />
                </Suspense>
              ) : adding ? (
                <AddProvider
                  templates={templates}
                  connections={providers}
                  blocked={dirty || !!editor || busy || needsReconcile}
                  accountAddition={accountAddition}
                  login={(providerId, proxy, type) => startLogin({ providerId, type, ...(type === "oauth" ? { proxy } : {}) })}
                  close={() => { setAdding(false); document.getElementById("add-supplier")?.focus(); }}
                />
              ) : !p ? (
                <div className="empty-details">
                  <h2>{loading ? "正在读取本地配置…" : "连接你的模型"}</h2>
                  <p>{loading ? "仅读取配置和已保存的认证记录，不验证登录状态。" : "点击供应商旁的「+」，选择账号授权或自定义接口。"}</p>
                  {!loading && <div className="empty-connection-types"><span>OAuth 账号登录</span><span>API Key / 本地接口</span></div>}
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
                  {p.notices?.map(notice => <p className="field-help" key={notice}>{notice}</p>)}
                  <ModelAccountRecovery providerId={p.providerId} blocked={dirty || !!editor || busy || needsReconcile} activated={() => refreshAuthentication(p.providerId)} />
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
                      setLogin: startLogin,
                      accountAddition,
                      feedback: feedbackError ? feedback : "",
                      logoutProvider,
                      removeProvider,
                    }}
                  />
                  <MountOnVisit key={p.id} active={tab === "models"}>
                  <Suspense fallback={<p role="status">正在加载模型编辑器…</p>}>
                  <ModelRegistry
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
                      editorDirty,
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
                  </Suspense>
                  </MountOnVisit>
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
                  onClick={() => {
                    if (!dirty) { setEditor(null); return; }
                    setDecision({
                      title: "放弃修改？",
                      confirmLabel: "放弃修改",
                      danger: true,
                      text: "丢弃本页所有草稿及临时密钥，重新读取已发布配置；不会改变服务端配置。",
                      proceed: () => void load(),
                    });
                  }}
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
                    if (dirty) setDecision({
                      title: "重新读取配置？",
                      confirmLabel: "放弃并重新读取",
                      danger: true,
                      text: "这会丢弃当前未保存修改和临时密钥。取消可继续编辑。",
                      proceed: () => void load(),
                    });
                    else void load();
                  }}
                >
                  <Icon name="rotate-cw" />
                </button>
                <span className="save-state" data-dirty={dirty} role="status">
                  {loading ? "读取本地配置…" : busy ? "处理中…" : dirty ? "有未保存修改" : saved ? "已保存到本地" : "无未保存修改"}
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
          <ConfirmDialog key={decision.title} title={decision.title} description={decision.text}
            subject={decision.subject} warning={decision.warning} confirmLabel={decision.confirmLabel} danger={decision.danger}
            onClose={() => setDecision(current => current === decision ? null : current)}
            onConfirm={() => { setDecision(null); decision.proceed(); }} />
        )}
      </main>
    </div>
  );
}
