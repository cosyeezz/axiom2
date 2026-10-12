import { useState, useEffect, useRef } from "react";
import { Icon } from "../components.js";
import { command, useConnection, useScope } from "../transport.js";
import type { Configuration } from "../../shared/protocol.js";
import type {
  ModelDraft as Model,
  ProviderDraft as Provider,
  ModelConfiguration,
} from "../../shared/models.js";
const empty: Configuration = {
  revision: "",
  providerCount: 0,
  modelCount: 0,
  available: [],
  dataRoot: "",
};
export function useConfiguration() {
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

  return {
    config,
    connection,
    revision,
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
    setFeedback,
    copyFeedback,
    decision,
    setDecision,
    p,
    load,
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
