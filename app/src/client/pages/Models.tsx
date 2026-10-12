import { useEffect, useState } from "react";
import { Dialog, Icon, SettingsSidebar } from "../components.js";
import { useScope } from "../transport.js";
import type { Configuration } from "../../shared/protocol.js";
import "../styles/models.css";
import "../styles/model-interactions.css";

type Row = { id: string; key: string; value: string };
type Model = {
  key: string;
  id: string;
  name: string;
  levels: string[];
  headers: Row[];
};
type Provider = {
  id: string;
  name: string;
  api: string;
  url: string;
  key: string;
  headers: Row[];
  models: Model[];
};
const levels = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const empty: Configuration = {
  revision: "",
  providerCount: 0,
  modelCount: 0,
  available: [],
  dataRoot: "",
};

export default function Models() {
  const config = useScope("configuration", empty);
  const [providers, setProviders] = useState<Provider[]>([]),
    [selected, setSelected] = useState("");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState(""),
    [tab, setTab] = useState("suppliers");
  const [editor, setEditor] = useState<Model | null>(null),
    [showKey, setShowKey] = useState(false);
  const [feedback, setFeedback] = useState(""),
    [copyFeedback, setCopyFeedback] = useState("");
  const [decision, setDecision] = useState<{
    title: string;
    text: string;
    proceed: () => void;
  } | null>(null);
  const p = providers.find((p) => p.id === selected),
    dirty = providers.length > 0;
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    const navigate = (e: MouseEvent) => {
      const link = (e.target as Element).closest("a[href]");
      if (!dirty || !link || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      setDecision({
        title: "离开模型服务？",
        text: "当前草稿尚未保存，离开会丢失草稿及临时密钥。取消可留在本页继续编辑。",
        proceed: () => location.assign(link.getAttribute("href")!),
      });
    };
    window.addEventListener("beforeunload", leave);
    document.addEventListener("click", navigate);
    return () => {
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("click", navigate);
    };
  }, [dirty]);
  const patch = (change: Partial<Provider>) =>
    setProviders((all) =>
      all.map((item) => (item.id === selected ? { ...item, ...change } : item)),
    );
  const discardEditor = (proceed: () => void) => {
    if (!editor) {
      proceed();
      return;
    }
    setDecision({
      title: "放弃当前模型编辑？",
      text: "当前行内编辑尚未完成。确认将丢弃这部分输入，其他供应商和模型草稿仍保留。取消可继续编辑。",
      proceed,
    });
  };
  const add = () =>
    discardEditor(() => {
      const id = crypto.randomUUID();
      setProviders((all) => [
        ...all,
        {
          id,
          name: "新供应商",
          api: "openai-completions",
          url: "",
          key: "",
          headers: [],
          models: [],
        },
      ]);
      setSelected(id);
      setTab("suppliers");
      setEditor(null);
      setShowKey(false);
      setFeedback("供应商为本页未保存草稿，尚未发布到 pi。");
    });
  const select = (id: string) => {
    if (id === selected) return;
    discardEditor(() => {
      setSelected(id);
      setEditor(null);
      setShowKey(false);
      setFeedback("已保留其他供应商的草稿；顶部保存尚未接入。");
    });
  };
  const changeTab = (next: string) => {
    setTab(next);
    document.getElementById(next + "-tab")?.focus();
  };
  const copy = async (value: string, kind: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback(`已复制${kind}：${value}`);
    } catch {
      setCopyFeedback(`复制失败，请手动选择并复制${kind}：${value}`);
    }
  };
  const copyButton = (value: string, kind: string) => (
    <button
      className="icon-btn copy-model-value"
      type="button"
      aria-label={`复制${kind}：${value}`}
      onClick={() => void copy(value, kind)}
    >
      <Icon name="copy" />
    </button>
  );
  const rows =
    p?.models.filter((m) =>
      `${m.name} ${m.id}`.toLowerCase().includes(filter.toLowerCase()),
    ) || [];
  return (
    <div className="settings-app">
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
              {dirty ? "有未保存修改" : "无未保存修改"}
            </span>
            <button
              className="btn btn-ghost"
              id="reset-provider"
              disabled={!dirty}
              onClick={() =>
                setDecision({
                  title: "放弃修改？",
                  text: "丢弃本页所有草稿及临时密钥；不会改变服务端配置。",
                  proceed: () => {
                    setProviders([]);
                    setSelected("");
                    setEditor(null);
                  },
                })
              }
            >
              放弃修改
            </button>
            <button
              className="btn btn-primary"
              id="save-provider"
              disabled
              title="配置发布与认证尚未接入；草稿不会生效"
            >
              保存
            </button>
          </div>
        </header>
        <div className="container">
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
                        <small>未保存 · 本页草稿</small>
                      </span>
                    </button>
                  ))}
                {!providers.length && (
                  <p className="list-empty">暂无本页草稿</p>
                )}
              </div>
            </section>
            <div className="supplier-detail">
              {!p ? (
                <div className="empty-details">
                  <h2>添加供应商</h2>
                  <p>使用供应商列表旁的「添加供应商」按钮，填写连接信息。</p>
                  <p className="feedback" role="status">
                    {config.error ||
                      `服务端已配置 ${config.providerCount} 个供应商、${config.modelCount} 个模型；编辑现有配置与发布保存将在模型接入步骤开放。`}
                  </p>
                </div>
              ) : (
                <>
                  <div className="row-between detail-heading">
                    <div className="provider-heading-copy">
                      <h2>{p.name || "新供应商"}</h2>
                      <p className="meta">
                        {p.models.length} 个模型 · 本页草稿
                      </p>
                    </div>
                    <span className="tag">未保存 · 未连接</span>
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
                        <span className="draft-indicator">未保存</span>
                      </button>
                    ))}
                  </nav>
                  <div
                    id="suppliers-screen"
                    role="tabpanel"
                    aria-labelledby="suppliers-tab"
                    hidden={tab !== "suppliers"}
                  >
                    <form
                      id="provider-form"
                      onSubmit={(e) => e.preventDefault()}
                    >
                      <section className="section">
                        <div className="section-heading">
                          <h3>连接信息</h3>
                          <p>草稿尚未接入发布服务</p>
                        </div>
                        <div className="connection-fields">
                          <div className="grid-2">
                            <div className="field">
                              <label htmlFor="provider-name">供应商名称</label>
                              <input
                                className="input"
                                id="provider-name"
                                required
                                maxLength={80}
                                value={p.name}
                                onChange={(e) =>
                                  patch({ name: e.target.value })
                                }
                              />
                            </div>
                            <div className="field">
                              <label htmlFor="provider-protocol">
                                接口协议
                              </label>
                              <select
                                className="input"
                                id="provider-protocol"
                                value={p.api}
                                onChange={(e) => patch({ api: e.target.value })}
                              >
                                <option value="openai-completions">
                                  OpenAI 兼容
                                </option>
                                <option value="anthropic-messages">
                                  Anthropic
                                </option>
                                <option value="google-generative-ai">
                                  Google Gemini
                                </option>
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
                                placeholder="https://api.example.com/v1"
                                value={p.url}
                                onChange={(e) => patch({ url: e.target.value })}
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
                                  placeholder="输入 API 密钥"
                                  value={p.key}
                                  onChange={(e) =>
                                    patch({ key: e.target.value })
                                  }
                                />
                                <button
                                  className="icon-btn"
                                  type="button"
                                  aria-label={
                                    showKey ? "隐藏 API 密钥" : "显示 API 密钥"
                                  }
                                  aria-pressed={showKey}
                                  onClick={() => setShowKey(!showKey)}
                                >
                                  <svg aria-hidden="true" viewBox="0 0 24 24">
                                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" />
                                    <circle cx="12" cy="12" r="3" />
                                  </svg>
                                </button>
                              </div>
                              <span className="field-help">
                                密钥仅临时保留，不写入浏览器存储；清空可丢弃本页输入。
                              </span>
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
                        <BodyOverrides />
                      </div>
                      <div className="save-bar">
                        <div>
                          <p className="meta">
                            统一点击顶部「保存」后才会发布；当前发布尚未接入。
                          </p>
                          <p className="feedback" role="status">
                            {feedback}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() =>
                            setDecision({
                              title: "删除供应商草稿？",
                              text: "这里只删除未发布草稿，不执行服务端删除或退出登录。",
                              proceed: () => {
                                setProviders((all) =>
                                  all.filter((item) => item.id !== p.id),
                                );
                                setSelected("");
                              },
                            })
                          }
                        >
                          删除供应商
                        </button>
                      </div>
                    </form>
                    <p className="prototype-note">
                      配置、API Key / OAuth
                      认证及退出登录尚未接入。草稿仅保留在本页内存，刷新后丢失；保存不代表连接验证成功。
                    </p>
                  </div>
                  <section
                    className="model-registry"
                    id="models-screen"
                    role="tabpanel"
                    aria-labelledby="models-tab"
                    hidden={tab !== "models"}
                  >
                    <div className="row-between model-heading">
                      <div>
                        <h3>
                          模型列表{" "}
                          <span className="meta num">{p.models.length}</span>
                        </h3>
                        <p>
                          仅显示当前供应商的模型，新增模型自动归属当前供应商。
                        </p>
                      </div>
                      <div className="model-tools">
                        <input
                          className="input"
                          type="search"
                          placeholder="搜索模型名称或 ID"
                          aria-label="搜索当前供应商的模型"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        />
                        <button
                          className="btn"
                          id="add-model"
                          onClick={() =>
                            discardEditor(() =>
                              setEditor({
                                key: crypto.randomUUID(),
                                id: "",
                                name: "",
                                levels: ["none"],
                                headers: [],
                              }),
                            )
                          }
                        >
                          <Icon name="plus" />
                          添加模型
                        </button>
                      </div>
                    </div>
                    {editor && (
                      <section
                        className="inline-model-editor"
                        id="model-editor"
                        aria-labelledby="model-editor-heading"
                      >
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (!editor.id.trim()) return;
                            if (
                              p.models.some(
                                (m) =>
                                  m.key !== editor.key &&
                                  m.id === editor.id.trim(),
                              )
                            ) {
                              setFeedback("模型 ID 不能重复");
                              return;
                            }
                            const m = {
                              ...editor,
                              id: editor.id.trim(),
                              name: editor.name.trim() || editor.id.trim(),
                            };
                            patch({
                              models: [
                                ...p.models.filter((old) => old.key !== m.key),
                                m,
                              ],
                            });
                            setEditor(null);
                            setFeedback("已结束行内编辑；仍是未保存草稿。");
                          }}
                        >
                          <h2 id="model-editor-heading">
                            {p.models.some((m) => m.key === editor.key)
                              ? "编辑模型"
                              : "添加模型"}
                          </h2>
                          <div className="inline-model-fields">
                            <div className="field">
                              <label htmlFor="new-model-id">模型 ID</label>
                              <input
                                className="input num"
                                id="new-model-id"
                                autoFocus
                                required
                                maxLength={160}
                                placeholder="供应商提供的模型 ID"
                                value={editor.id}
                                onChange={(e) =>
                                  setEditor({ ...editor, id: e.target.value })
                                }
                              />
                            </div>
                            <div className="field">
                              <label htmlFor="new-model-name">显示名称</label>
                              <input
                                className="input"
                                id="new-model-name"
                                maxLength={80}
                                placeholder="留空时使用模型 ID"
                                value={editor.name}
                                onChange={(e) =>
                                  setEditor({ ...editor, name: e.target.value })
                                }
                              />
                            </div>
                            <div className="field" id="model-reasoning-field">
                              <label id="model-reasoning-label">
                                思考等级{" "}
                                <span className="meta">（可多选）</span>
                              </label>
                              <div
                                id="reasoning-level-options"
                                role="group"
                                aria-labelledby="model-reasoning-label"
                              >
                                {levels.map((level) => (
                                  <label key={level}>
                                    <input
                                      type="checkbox"
                                      value={level}
                                      name="model-reasoning-level"
                                      checked={editor.levels.includes(level)}
                                      onChange={(e) =>
                                        setEditor({
                                          ...editor,
                                          levels: levels.filter((l) =>
                                            l === level
                                              ? e.target.checked
                                              : editor.levels.includes(l),
                                          ),
                                        })
                                      }
                                    />
                                    <span>{level}</span>
                                  </label>
                                ))}
                              </div>
                              <span className="field-help">
                                选择模型支持的等级；再次点击可取消。pi
                                能力映射与校验尚未接入，当前不会用于请求。
                              </span>
                            </div>
                          </div>
                          <div className="override-grid">
                            <Headers
                              scope="model"
                              rows={editor.headers}
                              change={(headers) =>
                                setEditor({ ...editor, headers })
                              }
                            />
                            <BodyOverrides />
                          </div>
                          <div className="inline-model-actions">
                            <p className="feedback" role="status">
                              {feedback}
                            </p>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => setEditor(null)}
                            >
                              取消
                            </button>
                            <button className="btn" type="submit">
                              完成编辑
                            </button>
                          </div>
                        </form>
                      </section>
                    )}
                    <div className="card model-table">
                      <table
                        className="ds-table"
                        id="configured-model-table"
                        aria-label="当前供应商的模型"
                      >
                        <caption
                          id="model-copy-feedback"
                          role="status"
                          aria-live="polite"
                          aria-atomic="true"
                        >
                          {copyFeedback}
                        </caption>
                        <thead>
                          <tr>
                            <th className="name-col">显示名称</th>
                            <th className="id-col">模型 ID</th>
                            <th className="reasoning-col">思考设置</th>
                            <th className="actions-col">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((m) => (
                            <tr key={m.key}>
                              <td>
                                <div className="copyable-value">
                                  <span className="model-name">{m.name}</span>
                                  {copyButton(m.name, "模型名称")}
                                </div>
                                <div className="mobile-model-id">
                                  <code>{m.id}</code>
                                  {copyButton(m.id, "模型 ID")}
                                </div>
                                <span className="mobile-model-reasoning">
                                  {m.levels.join(" / ") || "不设置"}
                                </span>
                              </td>
                              <td className="id-col">
                                <div className="copyable-value">
                                  <code className="model-id">{m.id}</code>
                                  {copyButton(m.id, "模型 ID")}
                                </div>
                              </td>
                              <td className="reasoning-col">
                                {m.levels.join(" / ") || "不设置"}
                              </td>
                              <td>
                                <div className="model-actions">
                                  <button
                                    className="icon-btn"
                                    aria-label={`编辑模型：${m.name}`}
                                    onClick={() =>
                                      discardEditor(() =>
                                        setEditor(structuredClone(m)),
                                      )
                                    }
                                  >
                                    <svg aria-hidden="true" viewBox="0 0 24 24">
                                      <path d="m16 3 5 5-12 12H4v-5Z" />
                                    </svg>
                                  </button>
                                  <button
                                    className="icon-btn"
                                    aria-label={`删除模型：${m.name}`}
                                    onClick={() =>
                                      setDecision({
                                        title: "删除模型草稿？",
                                        text: "该模型尚未发布；仅从本页草稿移除。",
                                        proceed: () => {
                                          patch({
                                            models: p.models.filter(
                                              (item) => item.key !== m.key,
                                            ),
                                          });
                                          if (editor?.key === m.key)
                                            setEditor(null);
                                        },
                                      })
                                    }
                                  >
                                    <Icon name="close" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!rows.length && (
                        <div className="model-empty">
                          <strong>
                            {filter ? "没有匹配的模型" : "当前供应商暂无模型"}
                          </strong>
                          点击「添加模型」创建未保存草稿。
                        </div>
                      )}
                    </div>
                    <p className="prototype-note">
                      新增、编辑、删除及覆盖项均为草稿；「完成编辑」仅收起表单，统一点击顶部「保存」后生效。当前保存尚未开放，草稿不会进入工作台模型列表。
                    </p>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
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
function Headers({
  rows,
  change,
  scope,
}: {
  rows: Row[];
  change: (rows: Row[]) => void;
  scope: string;
}) {
  return (
    <section
      className="override-editor"
      aria-label={`${scope === "model" ? "模型" : "供应商"}请求头覆盖`}
    >
      <div className="override-heading">
        <h3>请求头覆盖</h3>
        <button
          className="btn btn-ghost"
          type="button"
          disabled={rows.length >= 100}
          onClick={() =>
            change([...rows, { id: crypto.randomUUID(), key: "", value: "" }])
          }
        >
          ＋ 添加一项
        </button>
      </div>
      <div className="override-rows">
        {rows.map((row, i) => (
          <div className="override-row" key={row.id}>
            <input
              className="input"
              aria-label={`第 ${i + 1} 项 key`}
              placeholder="key"
              maxLength={160}
              autoComplete="off"
              value={row.key}
              onChange={(e) =>
                change(
                  rows.map((r) =>
                    r.id === row.id ? { ...r, key: e.target.value } : r,
                  ),
                )
              }
            />
            <input
              className="input override-value"
              aria-label={`第 ${i + 1} 项 value`}
              placeholder="value"
              maxLength={8192}
              autoComplete="off"
              value={row.value}
              onChange={(e) =>
                change(
                  rows.map((r) =>
                    r.id === row.id ? { ...r, value: e.target.value } : r,
                  ),
                )
              }
            />
            <button
              className="icon-btn"
              type="button"
              aria-label={`删除第 ${i + 1} 项`}
              onClick={() => change(rows.filter((r) => r.id !== row.id))}
            >
              <Icon name="close" />
            </button>
          </div>
        ))}
        {!rows.length && <p className="override-empty">未设置覆盖项</p>}
      </div>
      <p className="field-help">模型优先；草稿和敏感值不写入浏览器存储。</p>
    </section>
  );
}
function BodyOverrides() {
  return (
    <section className="override-editor">
      <div className="override-heading">
        <h3>请求体覆盖</h3>
        <button
          className="btn btn-ghost"
          disabled
          title="仅允许 pi 支持的字段，映射校验尚未接入"
        >
          ＋ 添加一项
        </button>
      </div>
      <p className="override-empty">未设置覆盖项</p>
      <p className="field-help">
        仅支持 pi 可表达的模型参数；映射接入前禁用，不能保存后静默忽略。
      </p>
    </section>
  );
}
