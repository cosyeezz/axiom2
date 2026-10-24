import { useEffect, useId, useState, type ReactNode } from "react";
import { LocalPath } from "../LocalPath.js";
import { command, useConnectionState, useScope } from "../transport.js";
import { agentScope, emptyAgent, runLabels, type SessionEnvironment } from "../../shared/agent.js";
import { capabilitiesScope, capabilityPreferencesScope, type CapabilityState } from "../../shared/capabilities.js";
import type { Scope } from "../../shared/protocol.js";

const emptyCapabilities: CapabilityState = { revision: 0, locked: false, legacy: false, selection: null };
const emptyPreferences = { revision: 0 };
function MemoryDirectory({ scope, path, child }: { scope: Scope; path?: string | null; child: boolean }) {
  const [resolved, setResolved] = useState<{ key: string; path: string } | null>(null);
  const key = `${scope.workspaceId}:${scope.sessionId}`;
  useEffect(() => {
    if (child || path !== undefined) return;
    const controller = new AbortController();
    // Older running services already resolve memory files without a restart.
    void command<string>("memory.resolve", { path: "MEMORY.md" }, scope, crypto.randomUUID(), controller.signal)
      .then((file) => {
        if (!controller.signal.aborted) setResolved({ key, path: file.replace(/[\\/]MEMORY\.md$/, "") });
      }).catch(() => { /* Optional memory can be unavailable. */ });
    return () => controller.abort();
  }, [scope.workspaceId, scope.sessionId, key, path, child]);
  const directory = path ?? (resolved?.key === key ? resolved.path : undefined);
  return <p>记忆目录：{child ? "子会话无独立记忆目录" : directory
    ? <LocalPath path={directory} scope={scope} /> : "暂不可用"}</p>;
}
const environmentLabels = ["系统提示词", "工具列表", "记忆内容"] as const;
type EnvironmentLabel = typeof environmentLabels[number];
function EnvironmentPanel({ title, id, open, children }: {
  title: EnvironmentLabel; id: string; open: boolean; children: () => ReactNode;
}) {
  return <div className="environment-panel" id={id} role="region" aria-label={title} hidden={!open}>
    {open && <><h3>{title}</h3><div className="session-init-body">{children()}</div></>}
  </div>;
}
function EnvironmentSection({ title, children, className = "" }: {
  title: string; children: () => ReactNode; className?: string;
}) {
  const [open, setOpen] = useState(false);
  return <details className={`environment-section ${className}`} onToggle={(event) => {
    if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
  }}>
    <summary><span>{title}</span><small>{open ? "收起" : "schema"}</small></summary>
    {open && <div className="session-init-body">{children()}</div>}
  </details>;
}
export function Environment({ scope }: { scope: Scope }) {
  return <EnvironmentContent key={`${scope.workspaceId}:${scope.sessionId}`} scope={scope} />;
}
function EnvironmentContent({ scope }: { scope: Scope }) {
  const info = useScope(agentScope(scope), emptyAgent);
  const capabilities = useScope(capabilitiesScope(scope), emptyCapabilities);
  const preferences = useScope(capabilityPreferencesScope, emptyPreferences);
  const connection = useConnectionState();
  const [preview, setPreview] = useState<SessionEnvironment | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const panelId = useId();
  const [expanded, setExpanded] = useState<EnvironmentLabel[]>([]);
  const panelProps = (title: EnvironmentLabel) => ({ title, id: `${panelId}-${environmentLabels.indexOf(title)}`, open: expanded.includes(title) });
  const hasRuntime = !!info.environment, child = !!info.task;
  useEffect(() => {
    if (hasRuntime || child || !connection.connected) return;
    const controller = new AbortController();
    setPreview(null);
    setError("");
    // Preload on mount, NOT on opening a disclosure or sending the first message.
    void command<SessionEnvironment | null>("agent.environment", {}, scope, crypto.randomUUID(), controller.signal)
      .then(value => { if (!controller.signal.aborted) setPreview(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "环境预加载失败"); });
    return () => controller.abort();
  }, [scope.workspaceId, scope.sessionId, hasRuntime, child, capabilities.revision, preferences.revision,
    connection.connected, connection.generation, attempt]);
  const environment = info.environment ?? preview;
  const unavailable = <p>{error ? "预加载失败，可重试。" : child ? "子会话执行加载后展示。" : "正在预加载会话环境…"}</p>;
  return <section className="session-init session-environment" aria-label="会话初始化信息" data-expanded={expanded.length > 0}>
    <header className="session-init-head">
      <span>会话环境 · {child ? "子会话" : "主会话"}</span>
      <span>{environment?.source === "preview" ? "已预加载 · 未启动 session" : info.run ? runLabels[info.run.status] : environment ? "已记录环境" : "预加载中"}</span>
    </header>
    {error && !info.environment && <p className="environment-error" role="status">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>重试</button></p>}
    <div className="environment-tags" role="group" aria-label="会话环境内容">
      {environmentLabels.map(title => <button key={title} type="button" className="environment-tag"
        aria-label={title} aria-expanded={expanded.includes(title)} aria-controls={panelProps(title).id}
        onClick={() => setExpanded(current => current.includes(title) ? current.filter(item => item !== title) : [...current, title])}>
        {title}{title === "工具列表" && environment && <small aria-hidden="true">{environment.tools.length}</small>}
      </button>)}
    </div>
    <EnvironmentPanel {...panelProps("系统提示词")}>{() => <>
      {environment && <p>工作目录：<LocalPath path={environment.cwd} scope={scope} /></p>}
      {info.run && <p>模型：{info.run.selection.provider} / {info.run.selection.id}</p>}
      {environment?.source === "preview" && <p>与执行共用资源及原生提示词生成逻辑；运行时扩展变更将在执行后更新。</p>}
      {environment?.retry && <p>自动重试：{environment.retry.enabled ? `最多 ${environment.retry.maxRetries} 次，基础等待 ${environment.retry.baseDelayMs / 1000} 秒` : "已关闭"}
        {`；会话等待上限 ${environment.retry.maxAgentDelayMs / 1000} 秒；供应商层 ${environment.retry.provider.maxRetries ?? 0} 次`}</p>}
      {environment && <p>{environment.source === "preview" ? "预览不执行外部扩展" : `已加载扩展：${environment.extensions}`}</p>}
      {environment?.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
      {typeof environment?.systemPrompt === "string" ? <pre className="session-system-prompt" aria-label="系统提示词">{environment.systemPrompt || "（空）"}</pre>
        : environment ? <p>此会话尚未记录系统提示词，下次执行时加载并展示。</p> : unavailable}
    </>}</EnvironmentPanel>
    <EnvironmentPanel {...panelProps("工具列表")}>{() => <>
      {environment?.source === "preview" && <p>以下为可预生成的工具声明；MCP 和外部扩展的动态工具执行加载后补充。</p>}
      {!environment ? unavailable : environment.tools.length ? environment.tools.map(name => {
        const tool = environment.toolDefinitions?.find(tool => tool.name === name);
        return <EnvironmentSection key={name} title={name} className="environment-tool">{() => <>
          {tool ? <><p>{tool.description}</p><pre aria-label={`${name} schema`}>{JSON.stringify(tool.parameters, null, 2)}</pre></>
            : <p>历史快照未记录此工具的 schema，下次执行加载后展示。</p>}
        </>}</EnvironmentSection>;
      }) : <p>无工具</p>}
    </>}</EnvironmentPanel>
    <EnvironmentPanel {...panelProps("记忆内容")}>{() => <>
      <MemoryDirectory scope={scope} path={info.memoryDirectory} child={child} />
      {child ? <p>子会话不注入主会话记忆目录。</p> : <>
        <p>以下为会话开始注入的 Topic 目录。会话记忆文件与查询结果按需读取，不自动拼入系统提示词。</p>
        {environment?.memory ? <pre aria-label="记忆内容">{environment.memory.topics || "（空）"}</pre>
          : environment ? <p>历史快照未记录注入的记忆内容，下次执行加载后展示。</p> : unavailable}
      </>}
    </>}</EnvironmentPanel>
  </section>;
}
