import { Icon } from "../Icon.js";
import { emptyMaintenanceState } from "../../shared/maintenance.js";
import { BackendMaintenance } from "../maintenance/BackendMaintenance.js";
import { ComponentActions } from "../maintenance/ComponentCard.js";
import { componentInstallAction } from "../../shared/component-actions.js";
import { useEffect, useRef, useState } from "react";
import { command, useConnectionState, useScope } from "../transport.js";
import { emptyModelProxyState, type ModelProxyState, type ProxyKernel } from "../../shared/model-proxy.js";
import { ProxyProfileEditor, type ProxyDraft } from "./ProxyProfileEditor.js";
const statusText = { running: "运行中", starting: "启动中", stopped: "已停止", error: "异常" };
export function ModelProxyTool({ active }: { active: boolean }) {
  const state = useScope("builtin-tools:model-proxy", emptyModelProxyState), connection = useConnectionState();
  const [uninstall, setUninstall] = useState<{ kernel: ProxyKernel }>();
  const [draft, setDraft] = useState<ProxyDraft>(), [removing, setRemoving] = useState<string>();
  const maintenance = useScope("maintenance", emptyMaintenanceState);
  const [pending, setPending] = useState<{ id: string; op: string; target?: string; kernel?: ProxyKernel }>(), [feedback, setFeedback] = useState<{ text: string; error?: boolean; kernel?: ProxyKernel }>();
  const activeRequest = useRef<{ id: string; acknowledged: boolean } | undefined>(undefined);
  if (activeRequest.current && activeRequest.current.id === state.job?.id) activeRequest.current.acknowledged = true;
  // A job snapshot acknowledges an accepted request even if its receipt was lost on reconnect.
  const sending = !!pending && state.job?.id !== pending.id;
  const busy = sending || !!state.job?.running || !connection.connected;
  // Component standard: install/update/uninstall stay available; only an in-flight request or a lost connection blocks them.
  const locked = sending || !connection.connected;
  const inspecting = (sending && pending?.op === "modelProxy.inspect") || (!!state.job?.running && state.job.id === draft?.inspectionId);
  // 线路级过渡态：启动走维护任务（job.profileId 标明目标线路），停止在请求内完成（靠 pending）。
  const pendingJob = state.job?.running ? state.job : undefined;
  const transitionOf = (id: string): "starting" | "stopping" | undefined => {
    const op = pending?.target === id ? pending.op : undefined;
    if (op === "modelProxy.stop") return "stopping";
    if (op === "modelProxy.start") return "starting";
    if (pendingJob?.profileId === id && /启动/.test(pendingJob.message)) return "starting";
    return undefined;
  };
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
    const request = { id: requestId, acknowledged: false };
    activeRequest.current = request;
    setPending({ id: requestId, op, ...(typeof params.id === "string" ? { target: params.id } : {}), ...(params.kernel === "xray" || params.kernel === "mihomo" ? { kernel: params.kernel } : {}) }); setFeedback(undefined);
    try {
      const result = await command(op, { revision: state.revision, ...params }, {}, requestId) as ModelProxyState;
      if (activeRequest.current !== request) return result;
      if (op === "modelProxy.save") { setDraft(undefined); setFeedback({ text: "线路已保存，请启动后在模型供应商页选择。" }); }
      if (op === "modelProxy.remove") { setRemoving(undefined); setFeedback({ text: "线路已删除。使用此线路的供应商需要重新选择代理。" }); }
      if (op === "modelProxy.stop") setFeedback({ text: "线路已停止；使用此线路的模型请求会失败。" });
      return result;
    } catch (error) {
      if (activeRequest.current === request && (!request.acknowledged || !["UNCERTAIN", "DISCONNECTED"].includes((error as { code?: string }).code ?? ""))) setFeedback({ text: (error as Error).message, error: true, ...(params.kernel === "xray" || params.kernel === "mihomo" ? { kernel: params.kernel } : {}) });
    }
    finally { setPending(current => current?.id === requestId ? undefined : current); }
  }
  const error = sending ? undefined : feedback?.error ? feedback.text : state.error || state.job?.error;
  const kernelTask = maintenance.tasks.find(task => task.id === state.job?.id && ["check", "install", "uninstall"].includes(task.action));
  const jobKernel = kernelTask?.resource === "proxy:xray" ? "xray" : kernelTask?.resource === "proxy:mihomo" ? "mihomo" : undefined;
  const noticeKernel = feedback ? feedback.kernel : pending?.kernel ?? jobKernel;
  const editorNotice = !connection.connected ? { text: "连接已断开；重连后读取识别状态。", error: true }
    : state.job?.running ? { text: state.job.message }
    : inspecting ? { text: "正在提交识别任务…" }
    : error ? { text: error, error: true }
    : feedback?.text || state.job?.message ? { text: feedback?.text || state.job!.message } : undefined;
  return <article className="supplier-detail tools-detail" id="model-proxy" aria-labelledby="model-proxy-heading" style={active ? undefined : { display: "none" }}>
    <div className="detail-heading row-between"><div><h2 id="model-proxy-heading">模型代理</h2><p className="meta">为模型供应商提供应用内代理入口。</p></div><span className="tag">{state.profiles.filter(p => p.status === "running").length} 条运行中</span></div>
    <div className="tools-content">
      <div className="tools-feedback" aria-live="polite">{!noticeKernel && (error ? <p className="tools-error" role="alert">{error}</p> : feedback?.text ? <p role="status">{feedback.text}</p> : null)}{!connection.connected && <p>连接已断开；重连后读取当前状态。</p>}</div>
      <section className="section tools-section" aria-labelledby="proxy-install-heading">
        <div className="section-heading"><h3 id="proxy-install-heading">安装与更新</h3></div>
        {(["xray", "mihomo"] as const).map(kernel => {
          const installed = state.installations[kernel], latest = state.latest[kernel];
          const kernelLabel = kernel === "xray" ? "Xray-core" : "mihomo";
          const managed = state.managed || !state.platform && !state.supportError;
          const installAction = componentInstallAction({ label: kernelLabel, installation: installed ? "installed" : state.revision ? "missing" : "unknown", version: installed?.version, target: latest });
          return <BackendMaintenance showError={!(error && noticeKernel === kernel)} resource={`proxy:${kernel}`} label={kernel === "xray" ? "Xray-core" : "mihomo"} version={installed?.version ? `v${installed.version}` : installed ? "已安装" : state.revision ? "未安装" : undefined} description={kernel === "xray" ? "Xray 网络代理内核" : "mihomo 网络代理内核"} key={kernel}
            actions={<ComponentActions context={{ connected: connection.connected, sending, taskRunning: !!state.job?.running }} capabilities={[
              { id: "check-versions", label: `检查 ${kernelLabel} ${installed ? "更新" : "版本"}`, support: managed ? "supported" : "unsupported", conflictsWithTask: true, execute: () => void action("modelProxy.check", { kernel }) },
              { ...installAction, support: managed ? "supported" : "unsupported", execute: () => void action("modelProxy.install", { kernel }) },
              { id: "uninstall", label: "卸载内核", danger: true, execute: () => setUninstall({ kernel }) },
            ]} />}
            kind="dependency" availableVersion={latest ? `v${latest}` : undefined} availableVersionLabel="最新"
            details={<p className="maintenance-note">平台 · {state.platform || "读取中"}</p>}
            feedback={noticeKernel === kernel && (error || sending || feedback?.text) ? error ? <p className="tools-error" role="alert">{error}</p> : <p role="status">{sending ? "正在提交操作…" : feedback?.text}</p> : undefined}>
          {!managed && <p className="field-help">当前平台暂不提供内核下载、校验与版本自检；已安装的内核仍可启动线路。</p>}
          {uninstall?.kernel === kernel && <div className="tools-conflict inline-confirmation" role="group" aria-label={`确认卸载 ${kernel}`}>
            <p>停止使用 {kernel} 的线路并删除托管程序{kernel === "xray" ? "及节点识别所需文件" : ""}，正在使用这些线路的模型请求会中断。订阅、节点与供应商绑定保留；重新安装后可手动启动线路。</p>
            <div className="tools-actions"><button className="btn" onClick={() => setUninstall(undefined)}>暂不卸载</button><button className="btn confirm-danger" disabled={locked} onClick={() => { setUninstall(undefined); void action("modelProxy.uninstall", { kernel }); }}><Icon name="trash-2" />确认卸载</button></div>
          </div>}
        </BackendMaintenance>; })}
        {state.job?.running && !kernelTask && state.job.cancellable !== false && !inspecting && <button className="btn" disabled={pending?.op === "modelProxy.cancel" || !connection.connected} onClick={() => void action("modelProxy.cancel", { jobId: state.job!.id })}>取消操作</button>}
      </section>
      <section className="section tools-section" aria-labelledby="proxy-profiles-heading">
        <div className="section-heading"><h3 id="proxy-profiles-heading">代理线路</h3><p>启动的线路会随 Axiom 后台启动；停止线路会中断使用它的请求。</p></div>
        {!state.profiles.length && <p className="field-help">尚未添加线路。</p>}
        {state.profiles.map(profile => { const transition = transitionOf(profile.id); const shown = transition === "starting" ? "启动中" : transition === "stopping" ? "停止中" : statusText[profile.status]; return <div className="proxy-profile" key={profile.id} data-transition={transition}>
          <div className="row-between"><strong>{profile.name}</strong><span className={`tag${transition ? " proxy-tag-pending" : ""}`}>{shown}</span></div>
          <p className="field-help">{profile.kernel === "xray" ? `Xray-core${profile.node ? ` · ${profile.node}` : ""}` : `mihomo · ${profile.node}`}{profile.message ? ` · ${profile.message}` : ""}</p>
          <div className="tools-actions">
            <button className="btn btn-primary" aria-busy={transition ? true : undefined} disabled={busy || !!draft || !state.installations[profile.kernel]} onClick={() => void action(profile.status === "running" ? "modelProxy.stop" : "modelProxy.start", { id: profile.id })}>{transition === "starting" ? "启动中…" : transition === "stopping" ? "停止中…" : profile.status === "running" ? "停止线路" : "启动线路"}</button>
            <button className="btn" disabled={busy || !!draft} onClick={() => { setDraft({ revision: state.revision, id: profile.id, name: profile.name, kernel: profile.kernel, format: profile.kernel === "xray" && !profile.node ? "native" : "share", node: profile.node, source: "" }); setFeedback(undefined); }}>编辑</button>
            <button className="btn btn-ghost" disabled={busy || !!draft} onClick={() => setRemoving(profile.id)}>删除</button>
          </div>
          {removing === profile.id && <div className="tools-conflict inline-confirmation" role="alert"><p>删除「{profile.name}」会停止线路；已选择它的供应商需要重新配置。</p><div className="tools-actions"><button className="btn" disabled={busy} onClick={() => setRemoving(undefined)}>取消</button><button className="btn confirm-danger" disabled={busy} onClick={() => void action("modelProxy.remove", { id: profile.id })}>确认删除</button></div></div>}
        </div>; })}
        {!draft && <button className="btn" disabled={busy} onClick={() => { setDraft({ revision: state.revision, name: "", kernel: "xray", format: "share", node: "", source: "" }); setRemoving(undefined); setFeedback(undefined); }}>添加线路</button>}
        {draft && <ProxyProfileEditor draft={draft} setDraft={setDraft} state={state} busy={busy} conflict={conflict}
          inspecting={inspecting} notice={editorNotice} canCancelInspection={!!state.job?.running && pending?.op !== "modelProxy.cancel" && connection.connected}
          onCancelInspection={() => void action("modelProxy.cancel", { jobId: state.job!.id })}
          onInspect={async (source, kernel) => {
            if (!state.managed) return;
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
