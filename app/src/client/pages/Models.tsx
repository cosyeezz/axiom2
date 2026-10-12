import { useEffect, useState, useRef } from "react";
import { Dialog, Icon, SettingsSidebar } from "../components.js";
import { command, useConnection, useScope } from "../transport.js";
import type { Configuration } from "../../shared/protocol.js";
import { ModelLogin } from "./ModelLogin.js";
import "../styles/models.css";
import "../styles/model-interactions.css";

import {
  reasoningLevels as levels,
  samplingKeys,
  type OverrideRow as Row,
  type ModelDraft as Model,
  type ProviderDraft as Provider,
  type ModelConfiguration,
} from "../../shared/models.js";
const empty: Configuration = {
  revision: "",
  providerCount: 0,
  modelCount: 0,
  available: [],
  dataRoot: "",
};

export default function Models() {
  const config = useScope("configuration", empty),
    connection = useConnection();
  const [revision, setRevision] = useState("");
  const [templates, setTemplates] = useState<ModelConfiguration["templates"]>(
    [],
  );
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  const [needsReconcile, setNeedsReconcile] = useState(false);
  const [login, setLogin] = useState<{
    providerId: string;
    type: "api_key" | "oauth";
  } | null>(null);
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
  const p = providers.find((p) => p.id === selected);
  const load = async () => {
    setBusy(true);
    try {
      const data = await command<ModelConfiguration>("configuration.get");
      setProviders(data.providers);
      setRevision(data.revision);
      setTemplates(data.templates);
      setSelected((old) =>
        data.providers.some((p) => p.id === old)
          ? old
          : (data.providers[0]?.id ?? ""),
      );
      setEditor(null);
      setDirty(false);
      setNeedsReconcile(false);
      setShowKey(false);
      setFeedback("已读取已发布配置；已保存密钥和请求头值不回传。");
      return true;
    } catch (error) {
      setFeedback((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (connection === "已连接本地服务" && !initialized.current) {
      initialized.current = true;
      void load();
    }
  }, [connection]);
  const save = async (
    confirmLogout = false,
    allowCommands = false,
    confirmStop = false,
  ) => {
    setBusy(true);
    try {
      await command("configuration.save", {
        revision,
        providers,
        confirmLogout,
        allowCommands,
        confirmStop,
      });
      setNeedsReconcile(true);
      if (await load())
        setFeedback(
          "配置已发布并刷新目录；配置有效不代表远端认证或模型调用成功。",
        );
    } catch (error) {
      const e = error as Error & { code?: string };
      setFeedback(e.message);
      if (["PARTIAL_CONFIG_FAILURE", "UNCERTAIN"].includes(e.code ?? ""))
        setNeedsReconcile(true);
      if (
        e.code === "LOGOUT_CONFIRMATION_REQUIRED" ||
        e.code === "COMMAND_AUTHORIZATION_REQUIRED" ||
        e.code === "ACTIVE_RUNS_CONFIRMATION_REQUIRED"
      )
        setDecision({
          title:
            e.code === "LOGOUT_CONFIRMATION_REQUIRED"
              ? "确认供应商级退出登录？"
              : e.code === "ACTIVE_RUNS_CONFIRMATION_REQUIRED"
                ? "停止受影响的执行？"
                : "允许执行配置命令？",
          text:
            e.message +
            (e.code === "LOGOUT_CONFIRMATION_REQUIRED"
              ? "受影响供应商及其模型的请求头覆盖也将清除，以移除备用认证来源；外部环境变量不改写。"
              : e.code === "COMMAND_AUTHORIZATION_REQUIRED"
                ? "只应允许你自己配置并理解的命令。"
                : "停止不回滚已修改的项目文件。"),
          proceed: () =>
            void save(
              confirmLogout || e.code === "LOGOUT_CONFIRMATION_REQUIRED",
              allowCommands || e.code === "COMMAND_AUTHORIZATION_REQUIRED",
              confirmStop || e.code === "ACTIVE_RUNS_CONFIRMATION_REQUIRED",
            ),
        });
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty || editor || busy) e.preventDefault();
    };
    const navigate = (e: MouseEvent) => {
      const link = (e.target as Element).closest("a[href]");
      if (
        (!dirty && !editor && !busy) ||
        !link ||
        link.getAttribute("target") === "_blank" ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey
      )
        return;
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
  }, [dirty, editor, busy]);
  const patch = (change: Partial<Provider>) => {
    setDirty(true);
    setProviders((all) =>
      all.map((item) => (item.id === selected ? { ...item, ...change } : item)),
    );
  };
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
          providerId: "custom-" + id.slice(0, 8),
          name: "新供应商",
          api: "openai-completions",
          url: "",
          key: "",
          headers: [],
          body: [],
          models: [],
        },
      ]);
      setDirty(true);
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
      setFeedback("已保留其他供应商的草稿；顶部保存才会发布配置。");
    });
  };
  const removeProvider = (provider: Provider, stopConfirmed = false) => {
    setDecision({
      title: "删除供应商？",
      text: provider.originalId
        ? "立即退出该供应商，删除其模型与受管理认证；同供应商会话将需要重新选择模型。未保存的其他修改不会一并提交。"
        : "仅移除尚未发布的供应商草稿。",
      proceed: async () => {
        if (!provider.originalId) {
          setProviders((all) => all.filter((p) => p.id !== provider.id));
          setSelected("");
          setEditor(null);
          setDirty(true);
          return;
        }
        setBusy(true);
        try {
          const current =
            await command<ModelConfiguration>("configuration.get");
          await command("configuration.save", {
            revision,
            providers: current.providers.filter(
              (p) => p.providerId !== provider.providerId,
            ),
            confirmLogout: true,
            confirmStop: stopConfirmed,
          });
          setNeedsReconcile(true);
          if (await load())
            setFeedback(
              "已删除供应商并退出 pi 登录；项目文件与会话索引保持不变。",
            );
        } catch (error) {
          const e = error as Error & { code?: string };
          if (["PARTIAL_CONFIG_FAILURE", "UNCERTAIN"].includes(e.code ?? ""))
            setNeedsReconcile(true);
          setFeedback(e.message);
          if (e.code === "ACTIVE_RUNS_CONFIRMATION_REQUIRED")
            setDecision({
              title: "停止受影响的执行？",
              text: e.message + "停止不回滚项目文件。",
              proceed: () => removeProvider(provider, true),
            });
        } finally {
          setBusy(false);
        }
      },
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
              disabled={
                busy || needsReconcile || !dirty || !!editor || !revision
              }
              title={
                editor ? "请先完成或取消行内编辑" : "发布到应用独立的 pi 配置"
              }
              onClick={() => void save()}
            >
              {busy ? "处理中…" : needsReconcile ? "请先重新读取" : "保存"}
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
                          <p>
                            顶部保存统一发布；密钥通过 pi 原生认证接口管理。
                          </p>
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
                                <option value="openai-responses">
                                  OpenAI Responses
                                </option>
                                {![
                                  "openai-completions",
                                  "openai-responses",
                                  "anthropic-messages",
                                  "google-generative-ai",
                                ].includes(p.api) && (
                                  <option value={p.api}>{p.api}</option>
                                )}
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
                                    p.auth?.configured
                                      ? "已配置；留空保持不变"
                                      : "输入 API 密钥"
                                  }
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
                                已保存密钥不回传；空白保持原认证，输入替换。
                              </span>
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
                                认证来源：{p.auth?.source || "无"}{" "}
                                {p.auth?.type || ""}
                              </span>
                              <div className="row">
                                {p.auth?.methods.map((type) => (
                                  <button
                                    key={type}
                                    type="button"
                                    className="btn btn-ghost"
                                    disabled={
                                      dirty ||
                                      !!editor ||
                                      busy ||
                                      needsReconcile
                                    }
                                    onClick={() =>
                                      setLogin({
                                        providerId: p.providerId,
                                        type,
                                      })
                                    }
                                  >
                                    {type === "oauth"
                                      ? "OAuth 登录"
                                      : "API Key 登录"}
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
                          <p className="feedback" role="status">
                            {feedback}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={
                            !!p.originalId &&
                            (dirty || !!editor || busy || needsReconcile)
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
                                body: [],
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
                                多选模型支持的等级；none 对应 pi 的
                                off。保存时映射
                                thinkingLevelMap；会话每次只选择一个等级。
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
                            <BodyOverrides
                              rows={editor.body}
                              change={(body) => setEditor({ ...editor, body })}
                              api={p.api}
                            />
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
                                        text: m.originalId
                                          ? "先移出草稿；顶部保存时会退出整个供应商，同供应商其他模型也可能需要重新认证。"
                                          : "该模型尚未发布；仅从本页草稿移除。",
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
                    {!editor && (
                      <p className="feedback" role="status">
                        {feedback}
                      </p>
                    )}
                    <p className="prototype-note">
                      新增、编辑、删除及覆盖项均为草稿；「完成编辑」仅收起表单，顶部「保存」才发布。配置明确列出且
                      pi 判定认证可用的模型才进入工作台列表。
                    </p>
                  </section>
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
                    r.id === row.id
                      ? { ...r, key: e.target.value, keep: false }
                      : r,
                  ),
                )
              }
            />
            <input
              className="input override-value"
              aria-label={`第 ${i + 1} 项 value`}
              placeholder={row.keep ? "已保存；留空保留，输入替换" : "value"}
              maxLength={8192}
              autoComplete="off"
              value={row.value}
              onChange={(e) =>
                change(
                  rows.map((r) =>
                    r.id === row.id
                      ? { ...r, value: e.target.value, keep: false }
                      : r,
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
function BodyOverrides({
  rows,
  change,
  api,
}: {
  rows: Row[];
  change: (rows: Row[]) => void;
  api: string;
}) {
  const supported = [
    "openai-completions",
    "openai-responses",
    "azure-openai-responses",
  ].includes(api);
  return (
    <section className="override-editor" aria-label="请求体覆盖">
      <div className="override-heading">
        <h3>请求体覆盖</h3>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!supported || rows.length >= 30}
          onClick={() =>
            change([
              ...rows,
              { id: crypto.randomUUID(), key: "temperature", value: "1" },
            ])
          }
        >
          ＋ 添加一项
        </button>
      </div>
      <div className="override-rows">
        {rows.map((r, i) => (
          <div className="override-row" key={r.id}>
            <select
              className="input"
              aria-label={`第 ${i + 1} 项请求体字段`}
              value={r.key}
              onChange={(e) =>
                change(
                  rows.map((row) =>
                    row.id === r.id ? { ...row, key: e.target.value } : row,
                  ),
                )
              }
            >
              {samplingKeys.map((key) => (
                <option key={key}>{key}</option>
              ))}
            </select>
            <input
              className="input override-value"
              type="number"
              step="any"
              aria-label={`第 ${i + 1} 项请求体值`}
              value={r.value}
              onChange={(e) =>
                change(
                  rows.map((row) =>
                    row.id === r.id ? { ...row, value: e.target.value } : row,
                  ),
                )
              }
            />
            <button
              type="button"
              className="icon-btn"
              aria-label={`删除第 ${i + 1} 项请求体覆盖`}
              onClick={() => change(rows.filter((row) => row.id !== r.id))}
            >
              <Icon name="close" />
            </button>
          </div>
        ))}
      </div>
      {!rows.length && <p className="override-empty">未设置覆盖项</p>}
      <p className="field-help">
        {supported
          ? "映射 pi samplingParams；供应商项保存时落实到各模型，模型项优先。其他已有字段保留在服务端。"
          : "当前协议不支持采样请求体覆盖；不可保存后静默忽略。"}
      </p>
    </section>
  );
}
