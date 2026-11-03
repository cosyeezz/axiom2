import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Icon } from "../components.js";
import { command, useConnection, useConnectionState, useScope } from "../transport.js";
import type { Configuration } from "../../shared/protocol.js";
import type {
  ModelDraft as Model,
  ProviderDraft as Provider,
  ModelConfiguration,
  ProviderProxy,
} from "../../shared/models.js";
import { assignModelConfigIds, validModelPricing } from "../../shared/models.js";
// Optional false flags mean the same thing as omitted flags in server drafts.
const draftSnapshot = (value: unknown) => JSON.stringify(value, (key, item) =>
  item === false && ["clearKey", "keepUrl", "keep"].includes(key) ? undefined : item,
);
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
  const connectionState = useConnectionState();
  const [revision, setRevision] = useState("");
  const [storage, setStorage] = useState<ModelConfiguration["storage"]>();
  const [saved, setSaved] = useState(false);
  const [templates, setTemplates] = useState<ModelConfiguration["templates"]>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [savedProviders, setSavedProviders] = useState<Provider[]>([]);
  const initializedGeneration = useRef(0);
  const readSequence = useRef(0);
  const currentConnection = useRef(connectionState); currentConnection.current = connectionState;
  const [needsReconcile, setNeedsReconcile] = useState(false);
  const [confirmedGeneration, setConfirmedGeneration] = useState(-1);
  const [login, setLogin] = useState<{
    providerId: string;
    type: "api_key" | "oauth";
    proxy?: ProviderProxy;
  } | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]),
    [selected, setSelected] = useState("");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState(""),
    [tab, setTab] = useState("accounts");
  const [editor, setEditor] = useState<Model | null>(null);
  const [notice, setNotice] = useState({ message: "", error: false });
  const feedback = notice.message, feedbackError = notice.error;
  const setFeedback = useCallback((message: string, error = false) => setNotice({ message, error }), []);
  const [copyFeedback, setCopyFeedback] = useState("");
  const [decision, setDecision] = useState<ConfigurationDecision | null>(null);
  const p = useMemo(() => providers.find((p) => p.id === selected), [providers, selected]);
  // Draft updates replace arrays/objects; unrelated UI state must not serialize
  // every supplier and model again. Keep the same false-flag normalization.
  const savedProvidersSnapshot = useMemo(() => draftSnapshot(savedProviders), [savedProviders]);
  const providersSnapshot = useMemo(() => providers === savedProviders
    ? savedProvidersSnapshot
    : draftSnapshot(providers), [providers, savedProviders, savedProvidersSnapshot]);
  const dirty = providersSnapshot !== savedProvidersSnapshot;
  const editorKey = editor?.key;
  const editorSnapshot = useMemo(() => editor ? draftSnapshot(editor) : "", [editor]);
  const editorBaselineSnapshot = useMemo(() => editorKey === undefined ? "" : draftSnapshot(
    p?.models.find((m) => m.key === editorKey) ?? {
      key: editorKey,
      id: "",
      name: "",
      levels: ["none"],
      input: ["text"],
      headers: [],
      body: [],
    },
  ), [p?.models, editorKey]);
  const editorDirty = !!editor && editorSnapshot !== editorBaselineSnapshot;
  // One staging path for Finish, unified Save (including a hidden editor), and supplier switches.
  const stageEditor = (): Provider[] | null => {
    if (!editor || !p) return providers;
    if (!editorDirty) {
      setEditor(null);
      return providers;
    }
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
    setFeedback("已结束行内编辑；仍是未保存草稿。");
    return next;
  };
  const load = async (preferredProvider?: string) => {
    const sequence = ++readSequence.current, generation = currentConnection.current.generation;
    setFeedback("正在读取本地配置…");
    setBusy(true);
    try {
      const data = await command<ModelConfiguration>("configuration.get");
      if (sequence !== readSequence.current || generation !== currentConnection.current.generation || !currentConnection.current.connected) return null;
      setProviders(data.providers);
      setSavedProviders(data.providers);
      setRevision(data.revision);
      setTemplates(data.templates);
      setStorage(data.storage);
      setSaved(false);
      const preferred = preferredProvider || (!revision ? new URLSearchParams(location.search).get("provider") : undefined);
      setSelected(old => data.providers.find(p => p.providerId === preferred)?.id
        ?? (data.providers.some(p => p.id === old) ? old : data.providers[0]?.id ?? ""));
      setEditor(null);
      setNeedsReconcile(false);
      setConfirmedGeneration(generation);
      setFeedback("已读取已发布配置；已保存密钥和请求头值不回传。");
      return data;
    } catch (error) {
      if (sequence === readSequence.current && generation === currentConnection.current.generation) {
        setNeedsReconcile(true);
        setFeedback(`读取配置失败：${(error as Error).message}`, true);
      }
      return null;
    } finally {
      if (sequence === readSequence.current) setBusy(false);
    }
  };
  const refreshAuthentication = async (providerId?: string) => {
    setNeedsReconcile(true);
    return load(providerId);
  };
  useEffect(() => {
    // A socket can close between its open event and the first read. Retry only
    // the initial read on a new generation; never replay writes or replace drafts.
    if (connectionState.connected && !revision && initializedGeneration.current !== connectionState.generation) {
      initializedGeneration.current = connectionState.generation;
      void load();
    }
  }, [connectionState.connected, connectionState.generation, revision]);
  const save = async (
    confirmLogout = false,
    allowCommands = false,
    confirmStop = false,
  ) => {
    const next = stageEditor();
    if (!next) return;
    setSaved(false);
    setFeedback("正在保存连接和模型配置…");
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
      if (await load(next.find(provider => provider.id === selected)?.providerId)) {
        setSaved(true);
        setFeedback("保存成功：连接与模型配置已写入本地文件，账号认证保持不变。");
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
  const patch = useCallback((change: Partial<Provider>) => {
    setSaved(false);
    setFeedback("");
    setProviders((all) =>
      all.map((item) => (item.id === selected ? { ...item, ...change } : item)),
    );
  }, [selected, setFeedback]);
  const discardEditor = useCallback((proceed: () => void) => {
    if (!editorDirty) {
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
  }, [editorDirty]);
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
      setSelected(id);
      setTab("suppliers");
      setEditor(null);
      setFeedback("供应商为本页未保存草稿，尚未发布到 pi。");
    });
  const select = (id: string) => {
    if (id === selected) return;
    if (!stageEditor()) return;
    setSelected(id);
    setFeedback("已保留其他供应商的草稿；下方保存才会发布配置。");
  };
  const removeProvider = (provider: Provider, stopConfirmed = false) => {
    setDecision({
      title: "移除连接？",
      confirmLabel: provider.originalId ? "移除连接" : "移除草稿",
      danger: true,
      subject: provider.name || provider.providerId,
      text: provider.originalId
        ? "移除此连接及其模型配置；请先在账号页删除关联账号，否则操作会被拒绝。同连接会话需要重新选择模型，其他连接不受影响。"
        : "仅移除尚未发布的供应商草稿。",
      proceed: async () => {
        if (!provider.originalId) {
          setProviders((all) => all.filter((p) => p.id !== provider.id));
          setSelected("");
          setEditor(null);
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
              "已移除连接及其模型配置；其他连接、项目文件与会话索引保持不变。",
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
  const copy = useCallback(async (value: string, kind: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback(`已复制${kind}：${value}`);
    } catch {
      setCopyFeedback(`复制失败，请手动选择并复制${kind}：${value}`);
    }
  }, []);
  const copyButton = useCallback((value: string, kind: string) => (
    <button
      className="icon-btn copy-model-value"
      type="button"
      aria-label={`复制${kind}：${value}`}
      onClick={() => void copy(value, kind)}
    >
      <Icon name="copy" />
    </button>
  ), [copy]);
  const rows = useMemo(() => {
    if (filter === "") return p?.models || [];
    const needle = filter.toLowerCase();
    return p?.models.filter((m) => `${m.name} ${m.id}`.toLowerCase().includes(needle)) || [];
  }, [p?.models, filter]);

  return {
    config,
    connection,
    revision,
    storage,
    saved: saved && !dirty && !editorDirty,
    templates,
    dirty: dirty || editorDirty,
    editorDirty,
    stageEditor,
    busy,
    needsReconcile: needsReconcile || !connectionState.connected || confirmedGeneration !== connectionState.generation,
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
    removeProvider,
    changeTab,
    copyButton,
    rows,
  };
}
