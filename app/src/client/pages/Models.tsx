import { Dialog, Icon, SettingsSidebar } from "../components.js";
import { ModelLogin } from "./ModelLogin.js";
import { ProviderConnection } from "../models/ProviderConnection.js";
import { ModelRegistry } from "../models/ModelRegistry.js";
import { useConfiguration } from "../models/useConfiguration.js";
import "../styles/models.css";
import "../styles/model-interactions.css";
export default function Models() {
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
    save,
    patch,
    discardEditor,
    stageEditor,
    add,
    select,
    removeProvider,
    changeTab,
    copyButton,
    rows,
  } = useConfiguration();
  const hasError = feedback ? feedbackError : !!config.error;
  return (
    <div className="settings-app" data-feedback-error={hasError}>
      <SettingsSidebar page="models" />
      <main className="settings-main" id="content">
        <header className="topnav">
          <div className="row">
            <a
              className="icon-btn mobile-back"
              href="/settings.html"
              aria-label="返回配置概览"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="m15 5-7 7 7 7" />
              </svg>
            </a>
            <a className="mobile-config-link" href="/settings.html">
              配置
            </a>
            <span aria-hidden="true">/</span>
            <strong>模型服务</strong>
          </div>
          <div className="row toolbar-actions">
            <span className="save-state" data-dirty={dirty} role="status">
              {dirty ? "有未保存修改" : saved ? "已保存到本地" : "无未保存修改"}
            </span>
            <button
              className="btn btn-ghost"
              id="reset-provider"
              disabled={busy || (!dirty && !editor)}
              onClick={() =>
                setDecision({
                  title: "放弃修改？",
                  text: "丢弃本页所有草稿及临时密钥，重新读取已发布配置；不会改变服务端配置。",
                  proceed: () => void load(),
                })
              }
            >
              放弃修改
            </button>
            <button
              className="btn btn-primary"
              id="save-provider"
              disabled={busy || needsReconcile || !dirty || !revision}
              data-tooltip={"包含当前行内编辑，统一发布到共享 pi 配置"}
              onClick={() => void save()}
            >
              {busy ? "处理中…" : needsReconcile ? "请先重新读取" : saved ? "已保存" : "保存"}
            </button>
            <button
              className="btn btn-ghost"
              aria-label="重新读取配置"
              disabled={busy}
              onClick={() => {
                if (dirty || editor)
                  setDecision({
                    title: "重新读取配置？",
                    text: "这会丢弃当前未保存修改和临时密钥。取消可继续编辑。",
                    proceed: () => void load(),
                  });
                else void load();
              }}
            >
              重新读取
            </button>
          </div>
        </header>
        <p
          className="configuration-feedback"
          role={hasError ? "alert" : "status"}
          aria-live={hasError ? "assertive" : "polite"}
          aria-atomic="true"
          data-saved={saved}
          data-error={hasError}
        >
          {hasError && <strong className="configuration-error-label">配置错误 · </strong>}
          {feedback || config.error || (connection !== "已连接本地服务" ? connection : "")}
        </p>
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
                <button
                  className="btn btn-ghost add-supplier"
                  id="add-supplier"
                  type="button"
                  aria-label="添加供应商"
                  onClick={add}
                  disabled={!revision}
                >
                  <Icon name="plus" />
                </button>
              </div>
              <input
                type="search"
                className="input supplier-search"
                placeholder="搜索供应商"
                aria-label="搜索供应商"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="supplier-list">
                {providers
                  .filter((p) =>
                    p.name.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((p) => (
                    <button
                      key={p.id}
                      className="supplier-option"
                      aria-current={selected === p.id}
                      onClick={() => select(p.id)}
                    >
                      <span>
                        <strong>
                          <span className="supplier-name">
                            {p.name || "新供应商"}
                          </span>
                          <span className="tag">{p.models.length}</span>
                        </strong>
                        <small>
                          {p.originalId
                            ? p.auth?.configured
                              ? "已配置认证 · 未验证调用"
                              : "尚未配置认证"
                            : "未保存 · 本页草稿"}
                        </small>
                      </span>
                    </button>
                  ))}
                {!providers.length && <p className="list-empty">暂无供应商</p>}
              </div>
            </section>
            <div className="supplier-detail">
              {!p ? (
                <div className="empty-details">
                  <h2>添加供应商</h2>
                  <p>使用供应商列表旁的「添加供应商」按钮，填写连接信息。</p>
                  <p className="feedback" role="status">
                    {feedback || config.error || connection}
                  </p>
                </div>
              ) : (
                <>
                  <div className="row-between detail-heading">
                    <div className="provider-heading-copy">
                      <h2>{p.name || "新供应商"}</h2>
                      <p className="meta">
                        {p.models.length} 个模型 ·{" "}
                        {dirty ? "有未保存修改" : "已发布配置"}
                      </p>
                    </div>
                    <span className="tag">
                      {p.auth?.configured ? "已配置认证" : "未认证"}
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
                        {dirty && (
                          <span className="draft-indicator">未保存</span>
                        )}
                      </button>
                    ))}
                  </nav>
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
                      feedback,
                      removeProvider,
                    }}
                  />
                  <ModelRegistry
                    {...{
                      p,
                      tab,
                      filter,
                      setFilter,
                      editor,
                      setEditor,
                      discardEditor,
                      stageEditor,
                      patch,
                      feedback,
                      copyFeedback,
                      copyButton,
                      rows,
                      setDecision,
                    }}
                  />
                </>
              )}
            </div>
          </div>
        </div>
        {login && (
          <ModelLogin
            {...login}
            revision={revision}
            close={() => {
              setLogin(null);
              void load();
            }}
          />
        )}
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
