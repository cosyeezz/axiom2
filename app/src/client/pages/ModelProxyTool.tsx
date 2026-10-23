import { useEffect, useRef, useState } from "react";
import { command, useConnectionState, useScope } from "../transport.js";
import { emptyModelProxyState, type ModelProxyState } from "../../shared/model-proxy.js";
import { ProxyProfileEditor, type ProxyDraft } from "./ProxyProfileEditor.js";
const statusText = { running: "运行中", starting: "启动中", stopped: "已停止", error: "异常" };
export function ModelProxyTool({ active }: { active: boolean }) {
  const state = useScope("builtin-tools:model-proxy", emptyModelProxyState), connection = useConnectionState();
  const [draft, setDraft] = useState<ProxyDraft>(), [removing, setRemoving] = useState<string>();
  const [pending, setPending] = useState<{ id: string; op: string }>(), [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const latestState = useRef(state); latestState.current = state;
  // A job snapshot acknowledges an accepted request even if its receipt was lost on reconnect.
  const sending = !!pending && state.job?.id !== pending.id;
  const busy = sending || !!state.job?.running || !connection.connected;
  const inspecting = (sending && pending?.op === "modelProxy.inspect") || (!!state.job?.running && state.job.id === draft?.inspectionId);
  const conflict = !!draft && draft.revision !== state.revision;
  useEffect(() => { if (active && connection.connected) void command("modelProxy.get").catch((error: Error) => setFeedback({ text: error.message, error: true })); }, [active, connection.connected, connection.generation]);
  useEffect(() => { setFeedback(undefined); }, [state.job?.id]);
  useEffect(() => {
    const inspection = state.inspection;
    if (!inspection?.nodes.length) return;
    setDraft(current => {
      if (!current || current.inspectionId !== inspection.id || current.kernel !== (inspection.kernel ?? "mihomo") || current.nodes) return current;
      const node = inspection.nodes.find(node => node.name === current.node)?.name ?? inspection.nodes[0].name;
      return { ...current, nodes: inspection.nodes, node, name: current.name || node.slice(0, 80) };
    });
  }, [state.inspection, draft?.inspectionId]);
  async function action(op: string, params: Record<string, unknown> = {}, requestId = crypto.randomUUID()) {
    setPending({ id: requestId, op }); setFeedback(undefined);
    try {
      const result = await command(op, { revision: state.revision, ...params }, {}, requestId) as ModelProxyState;
      if (op === "modelProxy.save") { setDraft(undefined); setFeedback({ text: "线路已保存，请启动后在模型供应商页选择。" }); }
      if (op === "modelProxy.remove") { setRemoving(undefined); setFeedback({ text: "线路已删除。使用此线路的供应商需要重新选择代理。" }); }
      if (op === "modelProxy.stop") setFeedback({ text: "线路已停止；使用此线路的模型请求会失败。" });
      return result;
    } catch (error) {
      const acknowledged = latestState.current.job?.id === requestId;
      if (!acknowledged || !["UNCERTAIN", "DISCONNECTED"].includes((error as { code?: string }).code ?? "")) setFeedback({ text: (error as Error).message, error: true });
    }
    finally { setPending(current => current?.id === requestId ? undefined : current); }
  }
  const error = feedback?.error ? feedback.text : state.error || state.job?.error;
  const editorNotice = !connection.connected ? { text: "连接已断开；重连后读取识别状态。", error: true }
    : state.job?.running ? { text: state.job.message }
    : inspecting ? { text: "正在提交识别任务…" }
    : error ? { text: error, error: true }
    : feedback?.text || state.job?.message ? { text: feedback?.text || state.job!.message } : undefined;
  return <article className="supplier-detail tools-detail" id="model-proxy" aria-labelledby="model-proxy-heading" style={active ? undefined : { display: "none" }}>
    <div className="detail-heading row-between"><div><h2 id="model-proxy-heading">模型代理</h2><p className="meta">为模型供应商提供应用内代理入口。</p></div><span className="tag">{state.profiles.filter(p => p.status === "running").length} 条运行中</span></div>
    <div className="tools-content">
      <div className="tools-feedback" aria-live="polite">{error ? <p className="tools-error" role="alert">{error}</p> : <p role="status">{feedback?.text || state.job?.message || "按需安装内核，再添加线路。"}</p>}{!connection.connected && <p>连接已断开；重连后读取当前状态。</p>}</div>
      <section className="section tools-section" aria-labelledby="proxy-install-heading">
        <div className="section-heading"><h3 id="proxy-install-heading">安装与更新</h3><p>根据线路格式安装所需内核。当前平台：{state.platform || "读取中"}</p></div>
        {(["xray", "mihomo"] as const).map(kernel => {
          const installed = state.installations[kernel], latest = state.latest[kernel];
          const upToDate = !!installed && !!latest && installed.version === latest;
          return <div className="proxy-kernel" key={kernel}>
          <h4>{kernel === "xray" ? "Xray-core" : "mihomo"}</h4>
          <p className="field-help">当前：{state.installations[kernel] ? `v${state.installations[kernel]!.version}` : "未安装"} · 最新：{state.latest[kernel] ? `v${state.latest[kernel]}` : "尚未检查"}</p>
          <div className="tools-actions"><button className="btn" disabled={busy || !state.supported} onClick={() => void action("modelProxy.check", { kernel })}>检查 {kernel === "xray" ? "Xray" : "mihomo"} 更新</button><button className="btn btn-primary" disabled={busy || !state.supported || !latest || upToDate} onClick={() => void action("modelProxy.install", { kernel, version: latest })}>{upToDate ? "已是最新版本" : installed ? "安装已确认版本" : "安装内核"}</button></div>
        </div>; })}
        {state.job?.running && !inspecting && <button className="btn" disabled={pending?.op === "modelProxy.cancel" || !connection.connected} onClick={() => void action("modelProxy.cancel", { jobId: state.job!.id })}>取消操作</button>}
        <p className="field-help tools-help">从官方发布页下载，校验后安装到 Axiom 数据目录。更新后重新启动线路使用新版本。使用桌面代理软件的地址时，无需安装这里的内核。</p>
        {state.platform && !state.supported && <p className="tools-error">当前平台没有支持的官方内核发布包。</p>}
      </section>
      <section className="section tools-section" aria-labelledby="proxy-profiles-heading">
        <div className="section-heading"><h3 id="proxy-profiles-heading">代理线路</h3><p>启动的线路会随 Axiom 后台启动；停止线路会中断使用它的请求。</p></div>
        {!state.profiles.length && <p className="field-help">尚未添加线路。</p>}
        {state.profiles.map(profile => <div className="proxy-profile" key={profile.id}>
          <div className="row-between"><strong>{profile.name}</strong><span className="tag">{statusText[profile.status]}</span></div>
          <p className="field-help">{profile.kernel === "xray" ? `Xray-core${profile.node ? ` · ${profile.node}` : ""}` : `mihomo · ${profile.node}`}{profile.message ? ` · ${profile.message}` : ""}</p>
          <div className="tools-actions">
            <button className="btn btn-primary" disabled={busy || !!draft || !state.installations[profile.kernel]} onClick={() => void action(profile.status === "running" ? "modelProxy.stop" : "modelProxy.start", { id: profile.id })}>{profile.status === "running" ? "停止线路" : "启动线路"}</button>
            <button className="btn" disabled={busy || !!draft} onClick={() => { setDraft({ revision: state.revision, id: profile.id, name: profile.name, kernel: profile.kernel, format: profile.kernel === "xray" && !profile.node ? "native" : "share", node: profile.node, source: "" }); setFeedback(undefined); }}>编辑</button>
            <button className="btn btn-ghost" disabled={busy || !!draft} onClick={() => setRemoving(profile.id)}>删除</button>
          </div>
          {removing === profile.id && <div className="tools-conflict" role="alert"><p>删除「{profile.name}」会停止线路；已选择它的供应商需要重新配置。</p><button className="btn" disabled={busy} onClick={() => void action("modelProxy.remove", { id: profile.id })}>确认删除</button><button className="btn btn-ghost" disabled={busy} onClick={() => setRemoving(undefined)}>取消</button></div>}
        </div>)}
        {!draft && <button className="btn" disabled={busy} onClick={() => { setDraft({ revision: state.revision, name: "", kernel: "xray", format: "share", node: "", source: "" }); setRemoving(undefined); setFeedback(undefined); }}>添加线路</button>}
        {draft && <ProxyProfileEditor draft={draft} setDraft={setDraft} state={state} busy={busy} conflict={conflict}
          inspecting={inspecting} notice={editorNotice} canCancelInspection={!!state.job?.running && pending?.op !== "modelProxy.cancel" && connection.connected}
          onCancelInspection={() => void action("modelProxy.cancel", { jobId: state.job!.id })}
          onInspect={async (source, kernel) => {
            const requestId = crypto.randomUUID();
            setDraft(current => current ? { ...current, inspectionId: requestId, nodes: undefined } : current);
            const result = await action("modelProxy.inspect", { source, kernel }, requestId);
            if (result?.job && result.job.id !== requestId) setDraft(current => current?.inspectionId === requestId ? { ...current, inspectionId: result.job!.id, nodes: undefined } : current);
          }} onSave={() => {
            const { nodes, format, inspectionId, ...profile } = draft;
            void action("modelProxy.save", { ...profile, ...(draft.kernel === "xray" && format === "share" && draft.source.trim() ? { inspectionId } : {}) });
          }} onCancel={() => setDraft(undefined)} />}
        <p className="field-help tools-help">线路启动后，到<a href="/model-config.html">模型供应商</a>选择「使用内置代理」并保存。代理只在应用内生效。</p>
      </section>
    </div>
  </article>;
}
