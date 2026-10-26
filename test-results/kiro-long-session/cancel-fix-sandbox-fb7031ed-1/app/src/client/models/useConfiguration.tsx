import { useState, useEffect, useRef } from "react";
import { Icon } from "../components.js";
import { command, useConnection, useScope } from "../transport.js";
import type { Configuration } from "../../shared/protocol.js";
import type {
  ModelDraft as Model,
  ProviderDraft as Provider,
  ModelConfiguration,
  ProviderProxy,
} from "../../shared/models.js";
import { assignModelConfigIds, validModelPricing } from "../../shared/models.js";
const empty: Configuration = {
  revision: "",
  providerCount: 0,
  modelCount: 0,
  available: [],
  dataRoot: "",
};
export type ConfigurationDecision = {
  title: string;
  text: string;
  confirmLabel: string;
  danger?: boolean;
  subject?: string;
  warning?: string;
  proceed: () => void;
};
export function useConfiguration() {
  const config = useScope("configuration", empty),
    connection = useConnection();
  const [revision, setRevision] = useState("");
  const [storage, setStorage] = useState<ModelConfiguration["storage"]>();
  const [saved, setSaved] = useState(false);
  const [templates, setTemplates] = useState<ModelConfiguration["templates"]>(
    [],
  );
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  const logoutInFlight = useRef(false);
  const [needsReconcile, setNeedsReconcile] = useState(false);
  const [login, setLogin] = useState<{
    providerId: string;
    type: "api_key" | "oauth";
    proxy?: ProviderProxy;
  } | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]),
    [selected, setSelected] = useState("");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState(""),
    [tab, setTab] = useState("suppliers");
  const [editor, setEditor] = useState<Model | null>(null),
    [showKey, setShowKey] = useState(false);
  const [notice, setNotice] = useState({ message: "", error: false });
  const feedback = notice.message, feedbackError = notice.error;
  const setFeedback = (message: string, error = false) => setNotice({ message, error });
  const [copyFeedback, setCopyFeedback] = useState("");
  const [decision, setDecision] = useState<ConfigurationDecision | null>(null);
  const p = providers.find((p) => p.id === selected);
  const editorDirty =
    !!editor &&
    JSON.stringify(editor) !==
      JSON.stringify(
        p?.models.find((m) => m.key === editor.key) ?? {
          key: editor.key,
          id: "",
          name: "",
          levels: ["none"],
          input: ["text"],
          headers: [],
          body: [],
        },
      );
  // One staging path for Finish, unified Save (including a hidden editor), and supplier switches.
  const stageEditor = (): Provider[] | null => {
    if (!editor || !p) return providers;
    const id = editor.id.trim();
    if (!id) {
      setFeedback(
        `供应商「${p.name || p.providerId}」（${p.providerId}）→ 模型「${editor.name || "新增模型"}」→ 模型 ID 为空；请填写供应商提供的模型 ID。`,
        true,
      );
      setTab("models");
      requestAnimationFrame(() => document.getElementById("new-model-id")?.focus());
      return null;
    }
    if (editor.cost !== undefined && !validModelPricing(editor.cost)) {
      setFeedback(`模型「${editor.name || id}」→ 计费设置：请填写四项有效单价，必须大于或等于 0（美元 / 百万 Token）。`, true);
      setTab("models");
      requestAnimationFrame(() => document.getElementById("model-cost-input")?.focus());
      return null;
    }
    const model = { ...editor, id, name: editor.name.trim() || id };
    const models = assignModelConfigIds(p.models.some((m) => m.key === model.key)
      ? p.models.map((m) => (m.key === model.key ? model : m))
      : [...p.models, model]);
    const next = providers.map((item) =>
      item.id === p.id ? { ...item, models } : item,
    );
    setProviders(next);
    setEditor(null);
    setDirty(true);
    setFeedback("已结束行内编辑；仍是未保存草稿。");
    return next;
  };
  const load = async (preferredProvider?: string) => {
    setBusy(true);
    try {
      const data = await command<ModelConfiguration>("configuration.get");
      setProviders(data.providers);
      setRevision(data.revision);
      setTemplates(data.templates);
      setStorage(data.storage);
      setSaved(false);
      setSelected((old) =>
        preferredProvider && data.providers.some((p) => p.id === preferredProvider)
          ? preferredProvider
          : data.providers.some((p) => p.id === old)
            ? old
            : (data.providers[0]?.id ?? ""),
      );
      setEditor(null);
      setDirty(false);
      setNeedsReconcile(false);
      setShowKey(false);
      setFeedback("已读取已发布配置；已保存密钥和请求头值不回传。");
      return data;
    } catch (error) {
      setFeedback(`读取配置失败：${(error as Error).message}`, true);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const refreshAuthentication = async (providerId?: string) => {
    setNeedsReconcile(true);
    return load(providerId);
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
    const next = stageEditor();
    if (!next) return;
    setSaved(false);
    setFeedback("正在保存配置和密钥…");
    setBusy(true);
    try {
      await command("configuration.save", {
        revision,
        providers: next,
        confirmLogout,
        allowCommands,
        confirmStop,
      });
      setNeedsReconcile(true);
      if (await load()) {
        setSaved(true);
        setFeedback(
          next.some((provider) => provider.key.trim())
            ? "保存成功：配置和 API 密钥已写入本地文件。密钥不回显，留空可保留已保存的密钥。"
            : "保存成功：配置已写入本地文件，模型目录已刷新。",
        );
      }
    } catch (error) {
      const e = error as Error & { code?: string };
      setFeedback(`保存失败：${e.message}`, true);
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
          text: e.message,
          confirmLabel: e.code === "LOGOUT_CONFIRMATION_REQUIRED" ? "退出并保存" : e.code === "ACTIVE_RUNS_CONFIRMATION_REQUIRED" ? "停止并保存" : "允许命令并保存",
          danger: e.code !== "COMMAND_AUTHORIZATION_REQUIRED",
          warning: e.code === "LOGOUT_CONFIRMATION_REQUIRED"
              ? "受影响供应商及其模型的请求头覆盖也将清除，以移除备用认证来源；外部环境变量不改写。"
              : e.code === "COMMAND_AUTHORIZATION_REQUIRED"
                ? "只应允许你自己配置并理解的命令。"
                : "停止不回滚已修改的项目文件。",
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
  const patch = (change: Partial<Provider>) => {
    setSaved(false);
    setFeedback("");
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
      confirmLabel: "放弃编辑",
      danger: true,
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
          connectionType: "custom",
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
    if (!stageEditor()) return;
    setSelected(id);
    setShowKey(false);
    setFeedback("已保留其他供应商的草稿；下方保存才会发布配置。");
  };
  const logoutProvider = async (provider: Provider, confirmStop = false) => {
    if (logoutInFlight.current || busy || dirty || editor || needsReconcile || login || !provider.originalId || provider.connectionType === "oauth") return;
    logoutInFlight.current = true;
    setBusy(true);
    setSaved(false);
    setFeedback("正在退出认证…");
    try {
      const current = await command<ModelConfiguration>("configuration.get");
      if (!current.providers.some((item) => item.providerId === provider.providerId))
        throw Error("供应商配置已变化，请重新读取后重试。");
      await command("configuration.save", {
        revision,
        providers: current.providers.map((item) => item.providerId === provider.providerId
          ? { ...item, key: "", clearKey: true }
          : item),
        confirmLogout: true,
        confirmStop,
      });
      setNeedsReconcile(true);
      const refreshed = await load(provider.providerId);
      if (refreshed) {
        const remaining = refreshed.providers.find((item) => item.providerId === provider.providerId);
        setFeedback(remaining?.auth?.configured
          ? "已清除受管理认证；供应商和模型已保留。当前仍有环境变量等其他来源提供认证。"
          : "已退出认证；供应商和模型已保留，可填写新密钥后保存。");
        requestAnimationFrame(() => document.getElementById("provider-key")?.focus());
      }
    } catch (error) {
      const e = error as Error & { code?: string };
      setFeedback(`退出认证失败：${e.message}`, true);
      if (["PARTIAL_CONFIG_FAILURE", "UNCERTAIN", "REVISION_CONFLICT"].includes(e.code ?? ""))
        setNeedsReconcile(true);
      if (e.code === "ACTIVE_RUNS_CONFIRMATION_REQUIRED")
        setDecision({
          title: "停止受影响的执行并退出认证？",
          confirmLabel: "停止并退出认证",
          danger: true,
          text: e.message + "停止不回滚项目文件；供应商和模型配置保留。",
          proceed: () => void logoutProvider(provider, true),
        });
    } finally {
      logoutInFlight.current = false;
      setBusy(false);
    }
  };
  const removeProvider = (provider: Provider, stopConfirmed = false) => {
    setDecision({
      title: "删除供应商？",
      confirmLabel: provider.originalId ? "删除供应商" : "移除草稿",
      danger: true,
      subject: provider.name || provider.providerId,
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
          setFeedback(`删除供应商失败：${e.message}`, true);
          if (e.code === "ACTIVE_RUNS_CONFIRMATION_REQUIRED")
            setDecision({
              title: "停止受影响的执行？",
              confirmLabel: "停止并继续删除",
              danger: true,
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

  return {
    config,
    connection,
    revision,
    storage,
    saved: saved && !dirty && !editorDirty,
    templates,
    dirty: dirty || editorDirty,
    stageEditor,
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
    add,
    select,
    logoutProvider,
    removeProvider,
    changeTab,
    copyButton,
    rows,
  };
}
